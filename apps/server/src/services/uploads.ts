import { unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { and, eq, or } from 'drizzle-orm';
import type { Attachment } from '@phanteon/shared';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_PREFIXES,
  MAX_ARCHIVE_UPLOAD_BYTES,
  MAX_FILE_UPLOAD_BYTES,
  MAX_GUILD_IMAGE_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from '@phanteon/shared';
import { config } from '../config/env';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toAttachment } from '../db/mappers';
import { fileAudience } from '../realtime/audience';
import { verifyFileSignature } from './file-links';
import { AppError, badRequest, hidden, notFound } from '../http/errors';

const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
};

export type UploadKind = 'image' | 'video' | 'audio' | 'archive' | 'file';

/** Size ceiling per kind, so a zip does not get the image budget. */
export function uploadLimit(kind: UploadKind): number {
  if (kind === 'video') return MAX_VIDEO_UPLOAD_BYTES;
  if (kind === 'archive') return MAX_ARCHIVE_UPLOAD_BYTES;
  if (kind === 'file') return MAX_FILE_UPLOAD_BYTES;
  return 8 * 1024 * 1024;
}

function extOf(name: string): string {
  return extname(name || '').replace('.', '').toLowerCase();
}

export function classifyUpload(mimeType: string, filename: string): UploadKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  const ext = extOf(filename);
  if (ARCHIVE_EXTENSIONS.has(ext) || mimeType === 'application/zip') return 'archive';
  return 'file';
}

/** Images, video, audio and whitelisted archive/document extensions pass. */
function isAllowed(mime: string, filename: string): boolean {
  if (ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true;
  const ext = extOf(filename);
  return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

function asciiFilename(name: string): string {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'arquivo';
}

function imageSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // JPEG
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return { width: null, height: null };
}

/** Reads the tkhd box of an MP4/MOV to get the display size (harmless to skip when missing). */
function videoSize(bytes: Uint8Array): { width: number | null; height: number | null } {
  const needle = [0x74, 0x6b, 0x68, 0x64]; // 'tkhd'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  outer: for (let index = 0; index + 90 < bytes.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    // tkhd: 4 bytes size + 'tkhd' + version/flags, then width/height are the last 8 bytes
    const base = index + 4 + 4;
    const version = bytes[base];
    const sizeOffset = version === 1 ? base + 84 : base + 72;
    if (sizeOffset + 8 > bytes.length) break;
    const width = view.getUint32(sizeOffset) / 65536;
    const height = view.getUint32(sizeOffset + 4) / 65536;
    if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
    break;
  }
  return { width: null, height: null };
}

/** Enough to read PNG/GIF/JPEG headers and an MP4 `tkhd` box. */
const PROBE_BYTES = 256 * 1024;

/**
 * Streams the upload to disk in chunks. The size is checked before the first
 * chunk and again while copying, so a client that under-reports it is cut off
 * at the ceiling; nothing larger than `PROBE_BYTES` is ever held in memory.
 * Returns the leading bytes for the image/video probe.
 */
/** `BunFile.writer().write/end` types as `number | Promise<number>`; the file is on disk only after it settles. */
async function settle(result: number | Promise<number>): Promise<void> {
  await result;
}

async function writeChunked(file: File, path: string, limit: number, probeBytes: number): Promise<Uint8Array> {
  if (typeof file.size === 'number' && file.size > limit) throw tooLarge(limit);
  const sink = Bun.file(path).writer();
  const headParts: Uint8Array[] = [];
  let headLength = 0;
  let written = 0;
  try {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > limit) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(limit);
      }
      if (headLength < probeBytes) {
        const slice = value.subarray(0, Math.min(value.byteLength, probeBytes - headLength));
        headParts.push(slice.slice());
        headLength += slice.byteLength;
      }
      await settle(sink.write(value));
    }
    if (written === 0) throw badRequest('Arquivo vazio.');
    await settle(sink.end());
  } catch (error) {
    await settle(sink.end()).catch(() => undefined);
    await unlink(path).catch(() => undefined);
    throw error;
  }
  const head = new Uint8Array(headLength);
  let offset = 0;
  for (const part of headParts) {
    head.set(part, offset);
    offset += part.byteLength;
  }
  return head;
}

const tooLarge = (limit: number) =>
  new AppError('PAYLOAD_TOO_LARGE', `Este tipo de arquivo pode ter no máximo ${Math.round(limit / (1024 * 1024))} MB.`);

export async function saveAttachment(uploaderId: string, file: File, origin: string): Promise<Attachment> {
  if (file.size === 0) throw badRequest('Arquivo vazio.');
  const kind = classifyUpload(file.type, file.name);
  if (!isAllowed(file.type, file.name)) {
    throw badRequest('Tipo de arquivo não permitido. Envie imagens, vídeos, áudios, compactados ou documentos.');
  }
  const limit = uploadLimit(kind);
  if (file.size > limit) {
    throw new AppError('PAYLOAD_TOO_LARGE', `Arquivos ${kind === 'video' ? 'de vídeo' : 'desse tipo'} podem ter no máximo ${Math.round(limit / (1024 * 1024))} MB.`);
  }

  const extension = MIME_EXTENSIONS[file.type] ?? extOf(file.name) ?? 'bin';
  const id = newId();
  const path = join(config.uploadsDir, `${id}.${extension}`);
  // the probe only needs the first bytes, so a video never has to sit in memory
  const head = await writeChunked(file, path, limit, PROBE_BYTES);

  const size = kind === 'image' ? imageSize(head) : kind === 'video' ? videoSize(head) : { width: null, height: null };
  const row = {
    id,
    uploaderId,
    filename: asciiFilename(file.name || `arquivo.${extension}`),
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    url: `/files/${id}.${extension}`,
    width: size.width,
    height: size.height,
    createdAt: nowIso(),
  };
  db.insert(schema.attachments).values(row).run();
  return toAttachment(row, origin);
}

const SERVED_EXTENSIONS: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Rendered inline in the message; everything else is offered as a download. */
const INLINE_EXTENSIONS = new Set(['png', 'jpg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'ogv', 'mp3', 'ogg', 'wav']);

export const SAFE_FILENAME = /^[a-zA-Z0-9-]+\.[a-z0-9]{2,5}$/;
/** Guild icons and banners are not attachments: any signed-in user may load them. */
export const GUILD_IMAGE = /^guild-(icon|banner)-[a-zA-Z0-9-]+\.[a-z0-9]{2,5}$/;

export function findAttachmentByUrl(url: string) {
  return db.select({ id: schema.attachments.id }).from(schema.attachments).where(eq(schema.attachments.url, url)).get();
}

/**
 * Resolves a public `/files/<name>` request. Only files that exist inside the
 * uploads folder with a known extension are served — this covers both message
 * attachments and guild icons/banners.
 */
/**
 * Whether `userId` may take a message attachment of `attachmentUrl`. The file is
 * theirs as uploader, or it sits in a message of a channel they can read and
 * write to. Files not (yet) in any message belong to the uploader only.
 */
export function canReadAttachment(attachmentUrl: string, userId: string): boolean {
  const attachment = db.select().from(schema.attachments).where(eq(schema.attachments.url, attachmentUrl)).get();
  if (!attachment) return false;
  if (attachment.uploaderId === userId) return true;

  const channels = new Set<string>();
  for (const row of db
    .select({ channelId: schema.messages.channelId })
    .from(schema.messageAttachments)
    .innerJoin(schema.messages, eq(schema.messages.id, schema.messageAttachments.messageId))
    .where(eq(schema.messageAttachments.attachmentId, attachment.id))
    .all()) {
    channels.add(row.channelId);
  }
  for (const row of db
    .select({ channelId: schema.messages.channelId })
    .from(schema.messages)
    .where(eq(schema.messages.attachmentId, attachment.id))
    .all()) {
    channels.add(row.channelId);
  }
  // a DM runs on guildMemberIds alone, so that case uses its membership directly
  for (const channelId of channels) {
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    if (!channel) continue;
    if (channel.kind === 'dm') {
      const member = db
        .select({ userId: schema.channelMembers.userId })
        .from(schema.channelMembers)
        .where(and(eq(schema.channelMembers.channelId, channelId), eq(schema.channelMembers.userId, userId)))
        .get();
      if (member) return true;
    } else if (fileAudience(channelId).includes(userId)) {
      return true;
    }
  }
  return false;
}

export async function getServedFile(filename: string): Promise<{ path: string; mimeType: string; inline: boolean }> {
  if (!SAFE_FILENAME.test(filename)) throw notFound('Arquivo não encontrado.');
  const extension = filename.split('.').pop()!;
  const mimeType = SERVED_EXTENSIONS[extension];
  if (!mimeType) throw notFound('Arquivo não encontrado.');
  const path = join(config.uploadsDir, filename);
  if (!(await Bun.file(path).exists())) throw notFound('Arquivo não encontrado.');
  return { path, mimeType, inline: INLINE_EXTENSIONS.has(extension) };
}

export async function discardAttachment(uploaderId: string, attachmentId: string): Promise<void> {
  const row = db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.id, attachmentId))
    .get();
  if (!row || row.uploaderId !== uploaderId) throw hidden('Anexo não encontrado.');
  db.delete(schema.attachments).where(eq(schema.attachments.id, attachmentId)).run();
  await deleteUploadedFiles([row.url]);
}

/** `/files/<name>` → absolute path inside the uploads folder; anything else is ignored. */
function uploadPath(url: string | null): string | null {
  if (!url) return null;
  const name = url.split('/').pop() ?? '';
  if (!SAFE_FILENAME.test(name)) return null;
  return join(config.uploadsDir, name);
}

/** True when any table still points at this `/files/...` URL. */
function stillReferenced(url: string): boolean {
  const attachment = db.select({ id: schema.attachments.id }).from(schema.attachments).where(eq(schema.attachments.url, url)).get();
  if (attachment) return true;
  const guild = db
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(or(eq(schema.guilds.iconUrl, url), eq(schema.guilds.bannerUrl, url)))
    .get();
  if (guild) return true;
  const user = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(or(eq(schema.users.avatarUrl, url), eq(schema.users.bannerUrl, url)))
    .get();
  return Boolean(user);
}

/**
 * Removes uploads from disk once nothing references them any more. Called after
 * the database change is committed, so a failed unlink never undoes the deletion.
 */
export async function deleteUploadedFiles(urls: Iterable<string | null>): Promise<void> {
  for (const url of new Set(urls)) {
    if (!url || stillReferenced(url)) continue;
    const path = uploadPath(url);
    if (path) await unlink(path).catch(() => undefined);
  }
}

const GUILD_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Saves a guild icon or banner into `uploads/` and returns the public URL.
 * Kept separate from message attachments so guild images aren't tied to a user.
 */
export async function saveGuildImage(file: File, kind: 'icon' | 'banner'): Promise<string> {
  if (file.size === 0) throw badRequest('Arquivo vazio.');
  const extension = GUILD_IMAGE_EXTENSIONS[file.type];
  if (!extension) throw badRequest('Envie uma imagem PNG, JPEG, WebP ou GIF.');
  if (kind === 'banner' && file.type === 'image/gif') {
    throw badRequest('O banner deve ser PNG, JPEG ou WebP.');
  }

  const filename = `guild-${kind}-${newId()}.${extension}`;
  await writeChunked(file, join(config.uploadsDir, filename), MAX_GUILD_IMAGE_BYTES, 0);
  return `/files/${filename}`;
}
