import { and, desc, eq } from 'drizzle-orm';
import type { GuildBan } from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { nowIso } from '../db/ids';
import { toPublicUser } from '../db/mappers';
import type { GuildBanRow, UserRow } from '../db/schema';
import { badRequest, forbidden, notFound } from '../http/errors';
import { guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { getMembership, removeMemberFromGuild } from './guilds';
import { actorContext, canActOn, requirePermission } from './roles';
import { recordAudit } from './audit';

/** Upper bound for timed bans: 10 years, so a typo cannot overflow the clock. */
const MAX_BAN_DURATION_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_REASON_LENGTH = 300;

function toBan(row: GuildBanRow, user: UserRow, moderator: UserRow | null): GuildBan {
  return {
    guildId: row.guildId,
    user: toPublicUser(user),
    moderator: moderator ? toPublicUser(moderator) : null,
    reason: row.reason,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Deletes bans whose `expires_at` already passed and returns how many rows went away. */
export function purgeExpiredBans(guildId?: string): number {
  const now = nowIso();
  const rows = guildId
    ? db
        .select({ guildId: schema.guildBans.guildId, userId: schema.guildBans.userId, expiresAt: schema.guildBans.expiresAt })
        .from(schema.guildBans)
        .where(eq(schema.guildBans.guildId, guildId))
        .all()
    : db
        .select({ guildId: schema.guildBans.guildId, userId: schema.guildBans.userId, expiresAt: schema.guildBans.expiresAt })
        .from(schema.guildBans)
        .all();

  let removed = 0;
  for (const row of rows) {
    if (!row.expiresAt || row.expiresAt > now) continue;
    db.delete(schema.guildBans)
      .where(and(eq(schema.guildBans.guildId, row.guildId), eq(schema.guildBans.userId, row.userId)))
      .run();
    removed += 1;
  }
  return removed;
}

export function isBanned(guildId: string, userId: string): boolean {
  const row = db
    .select()
    .from(schema.guildBans)
    .where(and(eq(schema.guildBans.guildId, guildId), eq(schema.guildBans.userId, userId)))
    .get();
  if (!row) return false;
  if (row.expiresAt && row.expiresAt <= nowIso()) {
    db.delete(schema.guildBans)
      .where(and(eq(schema.guildBans.guildId, guildId), eq(schema.guildBans.userId, userId)))
      .run();
    return false;
  }
  return true;
}

/** Expired bans never reach the client, and the list is newest first. */
export function listBans(guildId: string, viewerId: string): GuildBan[] {
  const actor = actorContext(guildId, viewerId);
  requirePermission(actor, Permission.BanMembers, 'Você não pode ver os banimentos.');
  purgeExpiredBans(guildId);

  const rows = db
    .select()
    .from(schema.guildBans)
    .where(eq(schema.guildBans.guildId, guildId))
    .orderBy(desc(schema.guildBans.createdAt))
    .all();

  const userCache = new Map<string, UserRow | null>();
  const loadUser = (id: string | null): UserRow | null => {
    if (!id) return null;
    if (!userCache.has(id)) {
      userCache.set(id, db.select().from(schema.users).where(eq(schema.users.id, id)).get() ?? null);
    }
    return userCache.get(id) ?? null;
  };

  return rows
    .map((row) => {
      const user = loadUser(row.userId);
      if (!user) return null;
      return toBan(row, user, loadUser(row.moderatorId));
    })
    .filter((ban): ban is GuildBan => ban !== null);
}

export interface BanInput {
  reason?: string | null;
  /** null/undefined means a permanent ban. */
  durationMs?: number | null;
}

/**
 * Bans a user and removes them from the guild in one step. The target does not
 * need to be a member: banning an outsider keeps them locked out of invites.
 */
export function banMember(actorId: string, guildId: string, targetUserId: string, input: BanInput = {}): GuildBan {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.BanMembers, 'Você não pode banir membros.');
  if (targetUserId === actorId) throw badRequest('Você não pode banir a si mesmo.');
  if (targetUserId === actor.guild.ownerId) throw forbidden('Não é possível banir o dono do servidor.');
  if (!canActOn(actor, targetUserId)) throw forbidden('Você não pode banir alguém acima de você.');

  const target = db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).get();
  if (!target) throw notFound('Usuário não encontrado.');

  const reason = input.reason?.trim() || null;
  if (reason && reason.length > MAX_REASON_LENGTH) {
    throw badRequest(`O motivo pode ter no máximo ${MAX_REASON_LENGTH} caracteres.`);
  }

  const duration = input.durationMs ?? null;
  if (duration !== null) {
    if (!Number.isFinite(duration)) throw badRequest('Duração de banimento inválida.');
    if (duration > MAX_BAN_DURATION_MS) throw badRequest('A duração do banimento é muito longa.');
    if (duration <= 0) throw badRequest('A duração do banimento deve ser maior que zero.');
  }

  const expiresAt = duration === null ? null : new Date(Date.now() + duration).toISOString();
  const createdAt = nowIso();

  db.insert(schema.guildBans)
    .values({ guildId, userId: targetUserId, moderatorId: actorId, reason, expiresAt, createdAt })
    .onConflictDoUpdate({
      target: [schema.guildBans.guildId, schema.guildBans.userId],
      set: { moderatorId: actorId, reason, expiresAt, createdAt },
    })
    .run();

  if (getMembership(guildId, targetUserId)) removeMemberFromGuild(guildId, targetUserId);

  // the banned user only learns about it through their own socket
  hub.emitToUsers([targetUserId], { type: 'guild:delete', guildId });

  recordAudit(guildId, actorId, {
    action: 'member.ban',
    targetId: targetUserId,
    targetName: target.displayName,
    reason: expiresAt ? `${reason ?? 'Sem motivo'} (até ${expiresAt})` : reason,
  });
  const moderator = db.select().from(schema.users).where(eq(schema.users.id, actorId)).get() ?? null;
  const ban = toBan({ guildId, userId: targetUserId, moderatorId: actorId, reason, expiresAt, createdAt }, target, moderator);
  hub.emitToUsers(moderatorRecipients(guildId), { type: 'ban:add', guildId, ban });
  return ban;
}

export function unbanMember(actorId: string, guildId: string, targetUserId: string): void {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.BanMembers, 'Você não pode revogar banimentos.');
  const row = db
    .select()
    .from(schema.guildBans)
    .where(and(eq(schema.guildBans.guildId, guildId), eq(schema.guildBans.userId, targetUserId)))
    .get();
  if (!row) throw notFound('Este usuário não está banido.');
  db.delete(schema.guildBans)
    .where(and(eq(schema.guildBans.guildId, guildId), eq(schema.guildBans.userId, targetUserId)))
    .run();
  const target = db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).get();
  recordAudit(guildId, actorId, {
    action: 'member.unban',
    targetId: targetUserId,
    targetName: target?.displayName ?? null,
  });
  hub.emitToUsers(moderatorRecipients(guildId), { type: 'ban:remove', guildId, userId: targetUserId });
}

/** Members of the guild allowed to see the ban list. */
function moderatorRecipients(guildId: string): string[] {
  return guildMemberIds(guildId).filter((memberId) => {
    try {
      const actor = actorContext(guildId, memberId);
      return (actor.permissions & Permission.BanMembers) === Permission.BanMembers;
    } catch {
      return false;
    }
  });
}

/** Broadcasts a fresh ban list to every moderator that may see it. */
export function broadcastBans(guildId: string): void {
  const recipients = moderatorRecipients(guildId);
  if (recipients.length === 0) return;
  const bans = listBans(guildId, recipients[0]!);
  hub.emitToUsers(recipients, { type: 'bans:sync', guildId, bans });
}
