import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';

export interface LinkEmbed {
  url: string;
  siteName: string;
  title: string;
  description: string | null;
  image: string | null;
  color: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>()]+/g;

/** Hard cap so a wall of links never turns one message into a stack of cards. */
const MAX_EMBEDS = 3;

function trimPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/, '');
}

/** Direct media links are shown inline already, so they never need a card. */
function isMedia(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|ogg|wav)(\?.*)?$/i.test(url);
}

export function extractLinks(content: string): string[] {
  const matches = content.match(URL_PATTERN) ?? [];
  const unique = [...new Set(matches.map(trimPunctuation))].filter((url) => !isMedia(url));
  return unique.slice(0, MAX_EMBEDS);
}

const cache = new Map<string, Promise<LinkEmbed>>();

export function prefetchLink(url: string): Promise<LinkEmbed> {
  const cached = cache.get(url);
  if (cached) return cached;
  const promise = api.unfurl(url).then(({ embed }) => embed);
  cache.set(url, promise);
  return promise;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Discord-style link embed: a thin coloured bar, site name, title, description and preview image. */
export function LinkEmbeds({ urls }: { urls: string[] }) {
  const [embeds, setEmbeds] = useState<LinkEmbed[]>([]);

  useEffect(() => {
    let cancelled = false;
    setEmbeds([]);
    void Promise.allSettled(urls.map(prefetchLink)).then((results) => {
      if (cancelled) return;
      setEmbeds(
        results
          .filter((result): result is PromiseFulfilledResult<LinkEmbed> => result.status === 'fulfilled')
          .map((result) => result.value),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [urls]);

  if (embeds.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-1">
      {embeds.map((embed) => (
        <a
          key={embed.url}
          href={embed.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex w-full max-w-[432px] overflow-hidden rounded-sm border-l-4 bg-panel transition-colors hover:bg-panel-hover"
          style={{ borderColor: embed.color || 'var(--color-brand)' }}
        >
          <span className="min-w-0 flex-1 px-3 py-2">
            {embed.siteName ? <span className="block truncate text-[12px] text-muted">{embed.siteName}</span> : null}
            <span className="block truncate text-sm font-semibold text-link">
              {embed.title || hostOf(embed.url)}
            </span>
            {embed.description ? (
              <span className="mt-1 line-clamp-4 block whitespace-pre-wrap text-[13px] leading-snug text-normal">
                {embed.description}
              </span>
            ) : null}
            <span className="mt-1 flex items-center gap-1 text-[11px] text-faint">
              <ExternalLink size={10} aria-hidden /> {hostOf(embed.url)}
            </span>
          </span>
          {embed.image ? (
            <img src={embed.image} alt="" loading="lazy" className="h-auto w-[120px] shrink-0 object-cover" />
          ) : null}
        </a>
      ))}
    </div>
  );
}
