import type { MiddlewareHandler } from 'hono';
import { config } from '../config/env';
import type { AppVariables } from './context';

type HeaderGetter = (name: string) => string | undefined;

/**
 * Builds the origin used in absolute URLs. A forwarded host is only honoured
 * when `CORS_ORIGINS` lists that exact host, so a forged header cannot inject
 * its own domain into the URLs every client receives.
 */
export function publicOrigin(header: HeaderGetter, allowedHosts: string[]): string {
  const fallbackHost = header('host') ?? 'localhost';
  const forwardedHost = header('x-forwarded-host');
  if (forwardedHost && allowedHosts.includes(forwardedHost)) {
    const proto = header('x-forwarded-proto') === 'https' ? 'https' : 'http';
    return `${proto}://${forwardedHost}`;
  }
  // without a trusted proxy in front, the scheme is the connection's own
  return `${header('x-forwarded-proto') === 'https' ? 'https' : 'http'}://${fallbackHost}`;
}

/** Records the public origin of the request so upload URLs can be absolute. */
export const withOrigin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const url = new URL(c.req.url);
  const allowedHosts = config.corsOrigins
    .filter((origin) => origin !== '*')
    .map((origin) => {
      try {
        return new URL(origin).host;
      } catch {
        return origin;
      }
    });
  const get: HeaderGetter = (name) => c.req.header(name) ?? undefined;
  // the request URL is the trusted default when no header is present
  const origin = publicOrigin((name) => get(name) ?? (name === 'host' ? url.host : undefined), allowedHosts);
  c.set('origin', origin);
  await next();
};
