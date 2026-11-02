import { FileArchive, FileText, Music, Video } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Attachment } from '@phanteon/shared';
import { formatBytes } from '../../lib/format';
import { cn } from '../../lib/cn';
import { assetUrl } from '../../lib/asset-url';
import { gridShape } from '../../lib/media-gallery';
import { useUiStore, type LightboxItem } from '../../app/stores/ui';
import { VideoPlayer } from './media/VideoPlayer';

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

function VideoAttachment({ attachment }: { attachment: Attachment }) {
  return (
    <figure className="max-w-[520px]">
      <VideoPlayer
        src={assetUrl(attachment.url) ?? attachment.url}
        width={attachment.width}
        height={attachment.height}
        filename={attachment.filename}
      />
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

/** Grid tiles stay compact and even; the single image above keeps its own ratio instead. */
const TILE_ASPECT = 'aspect-[5/4]';
const LEAD_WIDE_ASPECT = 'aspect-[2/1]';

function toLightboxItems(attachments: Attachment[]): LightboxItem[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    // every attachment has a URL at this point; the helper types it loosely for previews
    url: assetUrl(attachment.url) ?? attachment.url,
    filename: attachment.filename,
    width: attachment.width,
    height: attachment.height,
  }));
}

/**
 * One image shows whole at its own ratio; several become a Discord-style frame
 * (see `gridShape`) with a large lead tile for three and five. A click hands
 * the whole message to the viewer, so the arrows walk through it.
 */
function ImageGrid({ attachments }: { attachments: Attachment[] }) {
  const single = attachments.length === 1 ? attachments[0]! : null;
  if (single) {
    return (
      <figure className="mt-1 max-w-[520px]">
        <button
          type="button"
          onClick={() => useUiStore.getState().openLightbox(toLightboxItems(attachments), 0)}
          className="block cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-outline"
          aria-label={`Abrir ${single.filename}`}
        >
          <img
            src={assetUrl(single.url) ?? single.url}
            alt={single.filename}
            loading="lazy"
            decoding="async"
            className="max-h-[360px] w-auto max-w-full rounded-md bg-app object-contain"
            style={{ aspectRatio: single.width && single.height ? `${single.width} / ${single.height}` : undefined }}
          />
        </button>
        <figcaption className="mt-0.5 text-[11px] text-muted">
          {single.filename} · {formatBytes(single.size)}
        </figcaption>
      </figure>
    );
  }

  const shape = gridShape(attachments.length);
  const open = (index: number) => useUiStore.getState().openLightbox(toLightboxItems(attachments), index);
  return (
    <ul
      // the lead tile spans two cells of whatever direction it stretches into
      className="mt-1 grid max-w-[520px] gap-1"
      style={{ gridTemplateColumns: `repeat(${shape.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))` }}
      aria-label={`${attachments.length} imagens`}
    >
      {attachments.map((attachment, index) => (
        <li
          key={attachment.id}
          className={cn(
            index === 0 && shape.lead === 'wide' && 'col-span-2',
            index === 0 && shape.lead === 'tall' && 'row-span-2',
          )}
        >
          <button
            type="button"
            onClick={() => open(index)}
            title={attachment.filename}
            aria-label={`Abrir ${attachment.filename}`}
            className={cn(
              'group/tile relative block size-full overflow-hidden rounded-md bg-app cursor-zoom-in',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-outline',
              index !== 0 || shape.lead === 'none' ? TILE_ASPECT : shape.lead === 'wide' ? LEAD_WIDE_ASPECT : 'h-full',
            )}
          >
            <img
              src={assetUrl(attachment.url)}
              alt={attachment.filename}
              loading="lazy"
              decoding="async"
              className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-[1.02]"
            />
          </button>
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
        if (kind === 'video') return <VideoAttachment key={attachment.id} attachment={attachment} />;
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
