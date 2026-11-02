import type { MiddlewareHandler } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import type { UserRow } from '../db/schema';
import { unauthorized } from '../http/errors';
import type { AppVariables } from '../http/context';
import { extractBearerToken, verifySessionToken } from './tokens';

export async function resolveUserFromToken(token: string): Promise<UserRow | null> {
  const { userId, tokenVersion } = await verifySessionToken(token);
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  // a logout or password change bumps the version; tokens issued before it stop working
  if (!user || user.tokenVersion !== tokenVersion) return null;
  return user;
}

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (!token) throw unauthorized();

  const user = await resolveUserFromToken(token);
  if (!user) throw unauthorized('Usuário não encontrado.');

  c.set('currentUser', user);
  await next();
};
