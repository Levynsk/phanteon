/**
 * Link preview rules, kept apart from the route so every check that matters
 * (which URLs may be fetched, which URLs may be returned) has one home.
 */

export interface Embed {
  url: string;
  siteName: string;
  title: string;
  description: string | null;
  image: string | null;
  color: string;
}

export const MAX_HTML_BYTES = 512 * 1024;
export const FETCH_TIMEOUT_MS = 5000;
/** A page may chain a few redirects; beyond that it is treated as unusable. */
export const MAX_REDIRECTS = 5;

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function ipv4IsPrivate(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/** `127.1`, `2130706433` and `0x7f.0.0.1` all mean loopback; normalise before judging. */
function normalizeIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length > 4 || parts.some((part) => part === '')) return null;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(part)) return null;
    const value = Number(part);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return null;
    values.push(value);
  }
  if (values.slice(0, -1).some((value) => value > 255)) return null;
  const last = values[values.length - 1]!;
  // a short form ("127.1") packs the remaining octets into the last number
  if (values.length < 4 && last > 255 ** (4 - values.length)) return null;
  const full: number[] = [];
  for (let index = 0; index < values.length - 1; index += 1) full.push(values[index]!);
  const width = 4 - values.length + 1;
  for (let shift = (width - 1) * 8; shift >= 0; shift -= 8) full.push(Math.floor(last / 256 ** (shift / 8)) % 256);
  return full;
}

function ipv6IsPrivate(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const octets = normalizeIpv4(mapped[1]!);
    return !octets || ipv4IsPrivate(octets);
  }
  // URL parsing rewrites `::ffff:127.0.0.1` as `::ffff:7f00:1`
  const mappedHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16);
    const low = parseInt(mappedHex[2]!, 16);
    return ipv4IsPrivate([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  if (bare.startsWith('::ffff:')) return true;
  if (bare === '::1' || bare === '::') return true;
  if (/^f[cd]/.test(bare)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(bare)) return true; // link local fe80::/10
  return false;
}

function hostIsInternal(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  // only a real IPv6 literal may contain a colon; `host:port` is never a hostname
  if (/^\[?[0-9a-f:.]+\]?$/i.test(host) && host.includes(':')) return ipv6IsPrivate(host);
  const octets = normalizeIpv4(host);
  if (octets) return ipv4IsPrivate(octets);
  // a bare name without a dot is a host on the local network (e.g. `intranet`)
  if (!host.includes('.')) return true;
  return false;
}

/** Only http(s) URLs that resolve to a public-looking host may be fetched or shown. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return !hostIsInternal(url.hostname);
}

/** Resolves a Location header against the page it came from; throws when the target is internal. */
export function redirectTarget(base: string, location: string): string {
  let next: URL;
  try {
    next = new URL(location, base);
  } catch {
    throw new Error('redirect inválido');
  }
  if (!isPublicHttpUrl(next.toString())) throw new Error('redirect para endereço interno');
  return next.toString();
}

/** An image is only kept when it is itself a public http(s) URL. */
export function publicImage(raw: string | null, base: string): string | null {
  if (!raw) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, base);
  } catch {
    return null;
  }
  return isPublicHttpUrl(resolved.toString()) ? resolved.toString() : null;
}

function metaContent(htmlText: string, keys: string[]): string | null {
  for (const key of keys) {
    // attribute order is not guaranteed, so try both directions
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = htmlText.match(pattern);
      if (match?.[1]) return truncate(decodeEntities(match[1]), 400);
    }
  }
  return null;
}

function titleTag(htmlText: string): string | null {
  const match = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? truncate(decodeEntities(match[1]), 200) : null;
}

export function fallbackEmbed(url: string): Embed {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep the raw value
  }
  return { url, siteName: host, title: '', description: null, image: null, color: '' };
}

/** Builds the card from the page HTML; never returns an internal image. */
export function readEmbed(htmlText: string, pageUrl: string): Embed {
  let host = pageUrl;
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    // keep the raw value
  }
  const image = publicImage(metaContent(htmlText, ['og:image', 'twitter:image', 'og:image:url']), pageUrl);
  return {
    url: pageUrl,
    siteName: metaContent(htmlText, ['og:site_name']) ?? host,
    title: metaContent(htmlText, ['og:title', 'twitter:title']) ?? titleTag(htmlText) ?? '',
    description: metaContent(htmlText, ['og:description', 'twitter:description', 'description']),
    image,
    color: '',
  };
}
