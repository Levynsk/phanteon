import { FileArchive, FileText, Music, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Attachment } from '@phanteon/shared';
import { formatBytes } from '../../lib/format';
import { cn } from '../../lib/cn';
import { assetUrl } from '../../lib/asset-url';

const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Which renderer a file gets, mirroring how Discord picks between media and a file card. */
function kindOf(attachment: Attachment): 'image' | 'video' | 'audio' | 'archive' | 'file' {
  if (attachment.mimeType.startsWith('image/')) return 'image';
  if (attachment.mimeType.startsWith('video/')) return 'video';
  if (attachment.mimeType.startsWith('audio/')) return 'audio';
  if (ARCHIVE_EXT.has(extensionOf(attachment.filename)) || attachment.mimeType === 'application/zip') return 'archive';
  return 'file';
}

function FileIcon({ kind }: { kind: ReturnType<typeof kindOf> }) {
  if (kind === 'archive') return <FileArchive size={20} aria-hidden />;
  if (kind === 'audio') return <Music size={20} aria-hidden />;
  if (kind === 'video') return <Video size={20} aria-hidden />;
  return <FileText size={20} aria-hidden />;
}

/** Non-image attachment: a single download card, like Discord's file pill. */
function FileCard({ attachment }: { attachment: Attachment }) {
  const kind = kindOf(attachment);
  return (
    <a
      href={assetUrl(attachment.url)}
      target="_blank"
      rel="noreferrer"
      download={kind !== 'video' && kind !== 'audio' ? attachment.filename : undefined}
      className="mt-1 flex w-fit max-w-[420px] items-center gap-3 rounded-md border border-divider bg-app/60 px-3 py-2.5 transition-colors hover:border-line-strong hover:bg-app"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-input text-muted">
        <FileIcon kind={kind} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-link">{attachment.filename}</span>
        <span className="block text-[11px] tabular-nums text-muted">{formatBytes(attachment.size)}</span>
      </span>
    </a>
  );
}

function VideoPlayer({ attachment }: { attachment: Attachment }) {
  const source = assetUrl(attachment.url);
  return (
    <figure className="mt-1 max-w-[520px]">
      <video
        src={source}
        controls
        preload="metadata"
        className="max-h-[360px] w-full rounded-md bg-app"
        style={{
          aspectRatio: attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined,
        }}
      >
      </video>
      <figcaption className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
        {attachment.filename} · {formatBytes(attachment.size)}
      </figcaption>
    </figure>
  );
}

function AudioPlayer({ attachment }: { attachment: Attachment }) {
  const source = assetUrl(attachment.url);
  return (
    <figure className="mt-1 w-full max-w-[420px] rounded-md border border-divider bg-app/60 px-3 py-2">
      <figcaption className="mb-1 truncate text-[12px] text-muted">{attachment.filename}</figcaption>
      <audio src={source} controls preload="metadata" className="w-full" />
    </figure>
  );
}

function ImageGrid({ attachments }: { attachments: Attachment[] }) {
  const single = attachments.length === 1 ? attachments[0]! : null;
  if (single) {
    return (
      <figure className="mt-1 max-w-[520px]">
        <a href={assetUrl(single.url)} target="_blank" rel="noreferrer" className="block">
          <img
            src={assetUrl(single.url)}
            alt={single.filename}
            loading="lazy"
            className="max-h-[360px] w-auto max-w-full rounded-md bg-app object-contain"
            style={{ aspectRatio: single.width && single.height ? `${single.width} / ${single.height}` : undefined }}
          />
        </a>
        <figcaption className="mt-0.5 text-[11px] text-muted">
          {single.filename} · {formatBytes(single.size)}
        </figcaption>
      </figure>
    );
  }

  return (
    <ul className="mt-1 grid max-w-[520px] grid-cols-3 gap-1" aria-label={`${attachments.length} anexos`}>
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a href={assetUrl(attachment.url)} target="_blank" rel="noreferrer" title={attachment.filename}>
            <img
              src={assetUrl(attachment.url)}
              alt={attachment.filename}
              loading="lazy"
              className="aspect-square w-full rounded-md bg-app object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Routes each attachment to the right renderer: image grid, video, audio or file card. */
export function MessageAttachments({ attachments, className }: { attachments: Attachment[]; className?: string }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => kindOf(attachment) === 'image');
  const others = attachments.filter((attachment) => kindOf(attachment) !== 'image');
  return (
    <div className={cn('flex flex-col', className)}>
      {images.length > 0 ? <ImageGrid attachments={images} /> : null}
      {others.map((attachment) => {
        const kind = kindOf(attachment);
        if (kind === 'video') return <VideoPlayer key={attachment.id} attachment={attachment} />;
        if (kind === 'audio') return <AudioPlayer key={attachment.id} attachment={attachment} />;
        return <FileCard key={attachment.id} attachment={attachment} />;
      })}
    </div>
  );
}

/** Thumbnail used in the composer, before the message is sent. */
export function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const kind = kindOf(attachment);
  if (kind === 'image') {
    return <img src={assetUrl(attachment.url)} alt={attachment.filename} className="size-full object-cover" />;
  }
  return (
    <span className="flex size-full flex-col items-center justify-center gap-0.5 bg-input px-1 text-muted">
      <FileIcon kind={kind} />
      <span className="w-full truncate text-center text-[9px]">{attachment.filename}</span>
    </span>
  );
}
