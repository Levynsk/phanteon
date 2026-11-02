import { Hono } from 'hono';
import { z } from 'zod';
import { USERNAME_PATTERN } from '@phanteon/shared';
import { requireAuth, resolveUserFromToken } from '../auth/middleware';
import { extractBearerToken, signSessionToken } from '../auth/tokens';
import { toSelfUser } from '../db/mappers';
import { tooManyRequests, unauthorized } from '../http/errors';
import type { AppVariables } from '../http/context';
import { clientIp, LOGIN_RULES, rateLimits } from '../http/rate-limit';
import { jsonBody } from '../http/validation';
import { loginUser, registerUser } from '../services/users';
import { changePassword, deleteAccount, logoutEverywhere, logoutKeepingSession, summarizeUserData } from '../services/account';

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_PATTERN, 'Use de 3 a 24 caracteres: minúsculas, números, "." ou "_".'),
  displayName: z.string().trim().min(1).max(40).optional(),
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.').max(128),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Informe seu usuário ou e-mail.'),
  password: z.string().min(1, 'Informe sua senha.'),
});

export const authRoutes = new Hono<{ Variables: AppVariables }>();

authRoutes.post('/register', jsonBody(registerSchema), async (c) => {
  const session = await registerUser(c.req.valid('json'));
  return c.json(session, 201);
});

authRoutes.post('/login', jsonBody(loginSchema), async (c) => {
  const { identifier, password } = c.req.valid('json');
  // two windows: one account cannot be guessed at, and one client cannot spray many accounts
  const key = identifier.trim().toLowerCase();
  const identifierLimit = rateLimits.hit(`login:id:${key}`, LOGIN_RULES.perIdentifier);
  const clientLimit = rateLimits.hit(`login:ip:${clientIp((name) => c.req.header(name))}`, LOGIN_RULES.perClient);
  if (!identifierLimit.allowed || !clientLimit.allowed) {
    const retryAfterMs = Math.max(identifierLimit.retryAfterMs, clientLimit.retryAfterMs);
    c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    throw tooManyRequests('Muitas tentativas. Aguarde um pouco e tente de novo.');
  }
  const session = await loginUser({ identifier, password });
  rateLimits.reset(`login:id:${key}`);
  return c.json(session);
});

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: toSelfUser(c.get('currentUser'), c.get('origin')) });
});

/**
 * Ends the session on every device. With `everywhere: false` this device gets a
 * fresh token back and only the others are signed out.
 */
authRoutes.post('/logout', requireAuth, async (c) => {
  const me = c.get('currentUser');
  if (c.req.query('everywhere') === 'false') {
    return c.json(await logoutKeepingSession(me.id, c.get('origin')));
  }
  logoutEverywhere(me.id);
  return c.body(null, 204);
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe sua senha atual.'),
  newPassword: z.string().min(8, 'A nova senha precisa ter ao menos 8 caracteres.').max(128),
});

/** Changing the password signs the other devices out and returns a new token. */
authRoutes.patch('/password', requireAuth, jsonBody(passwordSchema), async (c) => {
  return c.json(await changePassword(c.get('currentUser').id, c.req.valid('json')));
});

authRoutes.get('/account', requireAuth, (c) => {
  return c.json({ summary: summarizeUserData(c.get('currentUser').id) });
});

const deleteSchema = z.object({
  password: z.string().min(1, 'Informe sua senha.'),
  confirm: z.string().min(1, 'Digite seu nome de usuário.'),
});

/** LGPD art. 18, VI: erases the account and everything it owns. */
authRoutes.delete('/account', requireAuth, jsonBody(deleteSchema), async (c) => {
  return c.json(await deleteAccount(c.get('currentUser').id, c.req.valid('json')));
});

authRoutes.post('/refresh', async (c) => {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (!token) throw unauthorized();
  const user = await resolveUserFromToken(token);
  if (!user) throw unauthorized('Usuário não encontrado.');
  return c.json({ token: await signSessionToken(user.id, user.tokenVersion), user: toSelfUser(user, c.get('origin')) });
});
