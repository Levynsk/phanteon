import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { AuthSession, PublicUser, UserStatus } from '@phanteon/shared';
import { DEFAULT_ACCENT_COLORS, USER_STATUSES } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toPublicUser, toSelfUser } from '../db/mappers';
import type { UserRow } from '../db/schema';
import { AppError, badRequest, conflict, notFound } from '../http/errors';
import { guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { hashPassword, verifyPassword } from '../auth/password';
import { signSessionToken } from '../auth/tokens';

/** Two characters: enough that a query is a lookup, not a crawl. */
export const MIN_SEARCH_LENGTH = 2;

export function pickColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return DEFAULT_ACCENT_COLORS[hash % DEFAULT_ACCENT_COLORS.length]!;
}

export interface RegisterInput {
  username: string;
  displayName?: string;
  email: string;
  password: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export async function registerUser(input: RegisterInput): Promise<AuthSession> {
  const username = input.username.toLowerCase();
  const email = input.email.toLowerCase();

  const existing = db
    .select()
    .from(schema.users)
    .where(or(eq(schema.users.username, username), eq(schema.users.email, email)))
    .get();
  if (existing) {
    if (existing.username === username) {
      throw conflict('Este nome de usuário já está em uso.', { username: 'já em uso' });
    }
    throw conflict('Este e-mail já está cadastrado.', { email: 'já cadastrado' });
  }

  const row: UserRow = {
    id: newId(),
    username,
    displayName: input.displayName?.trim() || input.username,
    email,
    passwordHash: await hashPassword(input.password),
    avatarUrl: null,
    bannerUrl: null,
    bio: null,
    tokenVersion: 0,
    accentColor: pickColor(username),
    status: 'online',
    createdAt: nowIso(),
  };
  db.insert(schema.users).values(row).run();

  return { token: await signSessionToken(row.id, row.tokenVersion), user: toSelfUser(row) };
}

/** Compared against when the identifier does not exist, so both paths cost the same. */
let sentinelHash: Promise<string> | null = null;
const sentinel = () => (sentinelHash ??= hashPassword('phanteon-sentinel-password'));

/** One answer for every failure: unknown identifier, wrong password, bad input. */
const loginFailed = () => new AppError('UNAUTHORIZED', 'Usuário ou senha incorretos.');

export async function loginUser(input: LoginInput): Promise<AuthSession> {
  const identifier = input.identifier.trim().toLowerCase();
  const user = db
    .select()
    .from(schema.users)
    .where(or(eq(schema.users.username, identifier), eq(schema.users.email, identifier)))
    .get();

  // an unknown identifier still runs a full hash verification, so timing does
  // not reveal which accounts exist
  const hash = user ? user.passwordHash : await sentinel();
  const valid = await verifyPassword(input.password, hash);
  if (!user || !valid) throw loginFailed();

  return { token: await signSessionToken(user.id, user.tokenVersion), user: toSelfUser(user) };
}

export function getUserRow(userId: string): UserRow {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw notFound('Usuário não encontrado.');
  return user;
}

/**
 * Search by username, display name, `@username` (prefix) or user id. An exact
 * `@handle` or id match comes first, so pasting an id finds that user.
 */
export function searchUsers(query: string, excludeUserId: string, limit = 20, origin = ''): PublicUser[] {
  const trimmed = query.trim();
  // an empty term used to list strangers; a short one would allow crawling the base
  if (trimmed.replace(/^@/, '').length < MIN_SEARCH_LENGTH) return [];
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const term = `%${trimmed.toLowerCase()}%`;
  const prefix = `${handle.toLowerCase()}%`;
  return db
    .select()
    .from(schema.users)
    .where(
      and(
        ne(schema.users.id, excludeUserId),
        trimmed
          ? or(
              eq(schema.users.id, trimmed),
              sql`lower(${schema.users.username}) = ${handle.toLowerCase()}`,
              sql`lower(${schema.users.username}) like ${prefix}`,
              sql`lower(${schema.users.username}) like ${term}`,
              sql`lower(${schema.users.displayName}) like ${term}`,
            )
          : undefined,
      ),
    )
    .limit(limit)
    .all()
    .map((row) => toPublicUser(row, origin));
}

export interface UpdateProfileInput {
  displayName?: string;
  status?: UserStatus;
  accentColor?: string;
  /** null removes the image. Only `/files/...` paths or absolute upload URLs are kept. */
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
}

/** Rejects anything that is not an uploaded asset, so the field cannot point off-site. */
function sanitizeImage(value: string | null | undefined, current: string | null): string | null {
  if (value === undefined) return current;
  if (value === null || value === '') return null;
  const relative = value.replace(/^https?:\/\/[^/]+/, '');
  if (!relative.startsWith('/files/')) throw badRequest('Imagem inválida: envie o arquivo pelo app.');
  return relative;
}

export function updateProfile(userId: string, input: UpdateProfileInput, origin = ''): PublicUser {
  const current = getUserRow(userId);
  const status = input.status && USER_STATUSES.includes(input.status) ? input.status : current.status;

  const updated = db
    .update(schema.users)
    .set({
      displayName: input.displayName?.trim() || current.displayName,
      status,
      accentColor: input.accentColor ?? current.accentColor,
      avatarUrl: sanitizeImage(input.avatarUrl, current.avatarUrl),
      bannerUrl: sanitizeImage(input.bannerUrl, current.bannerUrl),
      bio: input.bio === undefined ? current.bio : input.bio?.trim() || null,
    })
    .where(eq(schema.users.id, userId))
    .returning()
    .get();

  const user = toSelfUser(updated, origin);
  // peers only ever see the public view: the private one (with the e-mail) stays with the owner
  const publicUser = toPublicUser(updated, origin);
  const peers = new Set<string>();
  for (const guildId of db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId)) {
    for (const memberId of guildMemberIds(guildId)) peers.add(memberId);
  }
  for (const dm of db
    .select({ userId: schema.channelMembers.userId })
    .from(schema.channelMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
    .where(and(eq(schema.channels.kind, 'dm'), sql`${schema.channelMembers.channelId} IN (
      SELECT channel_id FROM channel_members WHERE user_id = ${userId}
    )`))
    .all()) {
    peers.add(dm.userId);
  }

  hub.emitToUsers([userId], { type: 'user:update', user });
  const others = [...peers].filter((id) => id !== userId);
  if (others.length > 0) hub.emitToUsers(others, { type: 'user:update', user: publicUser });
  hub.announcePresence(user);
  return user;
}
