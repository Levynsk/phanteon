import { and, eq, or, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../auth/password';
import { signSessionToken } from '../auth/tokens';
import { db, schema } from '../db/client';
import { toSelfUser } from '../db/mappers';
import { badRequest, forbidden, unauthorized } from '../http/errors';
import { hub } from '../realtime/hub';
import { deleteUploadedFiles } from './uploads';
import { leaveAllVoice } from './voice';

export const MIN_PASSWORD_LENGTH = 8;

export interface UserDataSummary {
  guildsOwned: { id: string; name: string }[];
  guildsMember: string[];
  messages: number;
  attachments: number;
  directMessages: number;
  friends: number;
}

/**
 * What the account holds. Shown before a deletion is confirmed, and used to
 * refuse one that would take other people's servers down with it.
 */
export function summarizeUserData(userId: string): UserDataSummary {
  const count = (row: { count: number } | undefined) => Number(row?.count ?? 0);
  const guildsOwned = db
    .select({ id: schema.guilds.id, name: schema.guilds.name })
    .from(schema.guilds)
    .where(eq(schema.guilds.ownerId, userId))
    .all();
  const guildsMember = db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);
  const messages = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.authorId, userId))
    .get();
  const attachments = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.attachments)
    .where(eq(schema.attachments.uploaderId, userId))
    .get();
  const directMessages = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.channelMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
    .where(and(eq(schema.channelMembers.userId, userId), eq(schema.channels.kind, 'dm')))
    .get();
  const friends = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.relationships)
    .where(
      and(
        or(eq(schema.relationships.requesterId, userId), eq(schema.relationships.addresseeId, userId)),
        eq(schema.relationships.kind, 'accepted'),
      ),
    )
    .get();
  return {
    guildsOwned,
    guildsMember,
    messages: count(messages),
    attachments: count(attachments),
    directMessages: count(directMessages),
    friends: count(friends),
  };
}

/**
 * Bumps the session version: every token issued so far stops verifying, and the
 * open sockets are closed. Returns the updated row.
 */
function revokeSessions(userId: string) {
  const updated = db
    .update(schema.users)
    .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
    .where(eq(schema.users.id, userId))
    .returning()
    .get();
  hub.disconnectUser(updated.id);
  return updated;
}

/** Logout on every device; the caller keeps a new session for this one. */
export async function logoutKeepingSession(
  userId: string,
  origin = '',
): Promise<{ token: string; user: ReturnType<typeof toSelfUser> }> {
  const user = revokeSessions(userId);
  return { token: await signSessionToken(user.id, user.tokenVersion), user: toSelfUser(user, origin) };
}

/** Logout everywhere, including this device. */
export function logoutEverywhere(userId: string): void {
  revokeSessions(userId);
}

/** Password change signs every other device out and hands this one a new token. */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ token: string }> {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw unauthorized('Usuário não encontrado.');
  if (!input.newPassword || input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`A nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw unauthorized('Senha atual incorreta.');
  }
  const updated = db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.newPassword), tokenVersion: sql`${schema.users.tokenVersion} + 1` })
    .where(eq(schema.users.id, userId))
    .returning()
    .get();
  hub.disconnectUser(updated.id);
  return { token: await signSessionToken(updated.id, updated.tokenVersion) };
}

/**
 * Account deletion (LGPD art. 18, VI). Rows go through the schema's cascade;
 * uploaded files are removed from disk and open sockets and calls are closed.
 * A server owner must hand the server over or delete it first, so deleting an
 * account can never take other people's data down by surprise.
 */
export async function deleteAccount(
  userId: string,
  input: { password: string; confirm: string },
): Promise<{ deleted: true }> {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) throw unauthorized('Usuário não encontrado.');
  if (input.confirm !== user.username) {
    throw badRequest('Digite seu nome de usuário para confirmar a exclusão.', { confirm: 'não confere' });
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) throw unauthorized('Senha incorreta.');

  const owned = summarizeUserData(userId).guildsOwned;
  if (owned.length > 0) {
    throw forbidden(
      'Você é dono de servidores. Passe a posse para outro membro ou exclua o servidor antes de excluir a conta.',
    );
  }

  // collected before the rows disappear
  const attachmentUrls = db
    .select({ url: schema.attachments.url })
    .from(schema.attachments)
    .where(eq(schema.attachments.uploaderId, userId))
    .all()
    .map((row) => row.url);
  const guildIds = db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);
  const dmIds = db
    .select({ channelId: schema.channelMembers.channelId })
    .from(schema.channelMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
    .where(and(eq(schema.channelMembers.userId, userId), eq(schema.channels.kind, 'dm')))
    .all()
    .map((row) => row.channelId);
  const auditIds = db
    .select({ id: schema.auditLogs.id })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.actorId, userId))
    .all()
    .map((row) => row.id);

  hub.disconnectUser(userId);
  leaveAllVoice(userId);

  db.transaction((tx) => {
    // moderation history loses the identity, not the moderation itself
    for (const id of auditIds) {
      tx.delete(schema.auditLogs).where(eq(schema.auditLogs.id, id)).run();
    }
    tx.update(schema.auditLogs).set({ targetId: null, targetName: null }).where(eq(schema.auditLogs.targetId, userId)).run();
    tx.update(schema.guildBans).set({ moderatorId: null }).where(eq(schema.guildBans.moderatorId, userId)).run();
    // a direct conversation has no meaning once one side is gone
    for (const channelId of dmIds) tx.delete(schema.channels).where(eq(schema.channels.id, channelId)).run();
    // the account row: cascade removes memberships, roles, messages, reactions,
    // attachments, invites, relationships, bans and voice states
    tx.delete(schema.users).where(eq(schema.users.id, userId)).run();
  });

  await deleteUploadedFiles([...attachmentUrls, user.avatarUrl, user.bannerUrl]);
  return { deleted: true };
}
