import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/env';
import { unauthorized } from '../http/errors';

const secret = new TextEncoder().encode(config.jwtSecret);

export interface TokenPayload {
  userId: string;
  /** Matches `users.tokenVersion`; a mismatch means the session was revoked. */
  tokenVersion: number;
}

export async function signSessionToken(userId: string, tokenVersion = 0): Promise<string> {
  return new SignJWT({ userId, tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(config.jwtIssuer)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlSeconds}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: config.jwtIssuer });
    if (typeof payload.userId !== 'string') throw new Error('missing userId');
    const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
    return { userId: payload.userId, tokenVersion };
  } catch {
    throw unauthorized('Sessão inválida ou expirada. Entre novamente.');
  }
}

export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
