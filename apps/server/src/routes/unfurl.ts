import { Hono } from 'hono';
import type { AppVariables } from '../http/context';
import { AppError, badRequest } from '../http/errors';
import {
  FETCH_TIMEOUT_MS,
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
  fallbackEmbed,
  isPublicHttpUrl,
  readEmbed,
  redirectTarget,
  type Embed,
} from '../services/link-preview';

/** Mounted at `/api/unfurl`. */
export const unfurlRoutes = new Hono<{ Variables: AppVariables }>();

/** In-memory cache: link previews change slowly and must not be fetched on every render. */
const cache = new Map<string, { at: number; embed: Embed }>();
const TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function remember(key: string, embed: Embed): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), embed });
}

/**
 * Follows redirects one hop at a time, re-checking every destination, so a public
 * page cannot bounce the preview onto the local network.
 */
async function fetchFollowingSafeRedirects(start: string, signal: AbortSignal): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { 'user-agent': 'PhanteonBot/1.0 (+link preview)', accept: 'text/html,application/xhtml+xml' },
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    // discard the body before the next request
    await response.body?.cancel().catch(() => undefined);
    if (!location) return response;
    current = redirectTarget(current, location);
  }
  throw new Error('redirects demais');
}

unfurlRoutes.get('/', async (c) => {
  const raw = c.req.query('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw badRequest('Link inválido.');
  }
  if (!isPublicHttpUrl(parsed.toString())) throw badRequest('Este link não pode ser pré-visualizado.');

  const key = parsed.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return c.json({ embed: hit.embed });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFollowingSafeRedirects(key, controller.signal);
    const type = response.headers.get('content-type') ?? '';
    const finalUrl = isPublicHttpUrl(response.url) ? response.url : key;
    // a reply that is not a page is only a guess about the site: it is not cached
    if (!response.ok || !type.includes('text/html')) {
      return c.json({ embed: fallbackEmbed(finalUrl) });
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) throw new AppError('BAD_REQUEST', 'Página grande demais para pré-visualizar.');
    const html = new TextDecoder().decode(buffer.slice(0, MAX_HTML_BYTES));

    const embed = { ...readEmbed(html, finalUrl), url: key };
    remember(key, embed);
    return c.json({ embed });
  } catch {
    // an unreachable site still gets a minimal card with the domain
    const embed = fallbackEmbed(key);
    remember(key, embed);
    return c.json({ embed });
  } finally {
    clearTimeout(timer);
  }
});
