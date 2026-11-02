/**
 * Every URL that points at an uploaded file — avatars, banners, guild icons and
 * message attachments — is built here, so the rules live in one place:
 *
 * - inside Electron the request goes through `remote://` (the scheme `main.ts`
 *   forwards to the API) and carries the session token in `?access_token=`, which
 *   the main process turns into an `Authorization` header. The token never has to
 *   be readable by the page, and `<img>`/`<video>`/`<audio>` keep working;
 * - in a plain browser the API origin is used as-is;
 * - `data:`/`blob:` URLs (local previews, recordings) pass through untouched.
 */
import { getApiUrl } from '../lib/config';
import { currentToken } from './api';

export const ACCESS_TOKEN_PARAM = 'access_token';

export interface AssetUrlOptions {
  /** The session token; Electron moves it into the request header. */
  token?: string | null;
}

function absolute(url: string): string {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `${getApiUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** `http(s)://host:port/path?query` → `remote://host_port/path?query`. */
export function toRemoteUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
  // a standard scheme drops the port, so it is encoded into the host (`host_port`)
  const host = parsed.port ? `${parsed.hostname}_${parsed.port}` : parsed.hostname;
  return `remote://${host}${parsed.pathname}${parsed.search}`;
}

export function assetUrl(url: string | null | undefined, options: AssetUrlOptions = { token: currentToken() }): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  const base = absolute(url);
  if (!window.desktop) return base;

  const resolved = new URL(base);
  if (options.token) resolved.searchParams.set(ACCESS_TOKEN_PARAM, options.token);
  return toRemoteUrl(resolved.toString());
}
