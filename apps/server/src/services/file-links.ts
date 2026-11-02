import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived signed URLs for uploaded files.
 *
 * The server hands a URL that is only valid for a few minutes to whoever it has
 * already authorised to see the file, so `/files` never has to depend on the
 * browser sending a header: the signature carries the permission decision.
 * There is no table and no cleanup — a signature either verifies or it expires.
 */

export const FILE_URL_TTL_SECONDS = 5 * 60;

export interface SignedFileQuery {
  exp: string;
  sig: string;
}

function signature(secret: string, name: string, exp: number): string {
  return createHmac('sha256', secret).update(`${name}\n${exp}`).digest('base64url');
}

/** `name` is the bare file name (`id.png`), never a path. */
export function signFileUrl(secret: string, name: string, now = Date.now(), ttlSeconds = FILE_URL_TTL_SECONDS): SignedFileQuery {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return { exp: String(exp), sig: signature(secret, name, exp) };
}

/** True only for a signature that names this file and has not expired. */
export function verifyFileSignature(
  secret: string,
  name: string,
  query: Partial<Record<string, string | undefined>>,
  now = Date.now(),
): boolean {
  const exp = Number(query.exp);
  const sig = query.sig ?? '';
  if (!Number.isSafeInteger(exp) || exp <= 0) return false;
  if (exp * 1000 <= now) return false;
  const expected = Buffer.from(signature(secret, name, exp));
  const received = Buffer.from(sig);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Appends the signature to a stored `/files/<name>` path. Anything else is returned untouched. */
export function signedFilePath(secret: string, path: string | null, now = Date.now()): string | null {
  if (!path) return null;
  const name = path.split('?')[0]!.split('/').pop() ?? '';
  if (!path.startsWith('/files/') || !name) return path;
  const { exp, sig } = signFileUrl(secret, name, now);
  return `${path.split('?')[0]}?exp=${exp}&sig=${sig}`;
}
