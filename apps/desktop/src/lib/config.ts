/** Dev build talks to the API on this machine; the production bundle to the public host. */
const DEFAULT_API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3010' : 'https://phanteon.bonfires.eu.cc');

let resolvedApiUrl: string | null = null;

export async function resolveApiUrl(): Promise<string> {
  if (resolvedApiUrl) return resolvedApiUrl;
  if (window.desktop) {
    try {
      const fromElectron = await window.desktop.apiBaseUrl();
      resolvedApiUrl = fromElectron || DEFAULT_API_URL;
      return resolvedApiUrl ?? DEFAULT_API_URL;
    } catch {
      // fall through to the compiled default
    }
  }
  resolvedApiUrl = DEFAULT_API_URL;
  return DEFAULT_API_URL;
}

/** Synchronous access after `resolveApiUrl()` ran during bootstrap. */
export function getApiUrl(): string {
  return resolvedApiUrl ?? DEFAULT_API_URL;
}

/**
 * Test hook only: pins the API base before the first use, because
 * `resolveApiUrl()` caches it. Not called by the app.
 */
export async function resolveApiUrlFrom(url: string): Promise<string> {
  resolvedApiUrl = url;
  return url;
}

/**
 * WebSockets keep their own `ws:`/`wss:` scheme; `remote:` is HTTP-only.
 * The token is not part of the URL: the socket sends it as its first frame.
 */
export function toWebSocketUrl(apiUrl: string): string {
  const url = new URL('/ws', apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

