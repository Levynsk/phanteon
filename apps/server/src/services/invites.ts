import { and, desc, eq } from 'drizzle-orm';
import type { GuildInvite } from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newInviteCode, nowIso } from '../db/ids';
import type { InviteRow, UserRow } from '../db/schema';
import { badRequest, hidden } from '../http/errors';
import { actorContext, requirePermission } from './roles';
import { recordAudit } from './audit';

/** Hard ceiling for timed invites: 30 days, like Discord's longest option. */
export const MAX_INVITE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_INVITE_USES = 100;

export interface CreateInviteInput {
  /** 0 or undefined means unlimited. */
  maxUses?: number;
  /** null/undefined means the invite never expires. */
  durationMs?: number | null;
}

export function inviteIsActive(row: InviteRow, now = nowIso()): boolean {
  if (row.expiresAt && row.expiresAt <= now) return false;
  if (row.maxUses > 0 && row.uses >= row.maxUses) return false;
  return true;
}

/** Human readable reason, used both by the API and by the join route. */
export function inviteInactiveReason(row: InviteRow, now = nowIso()): string | null {
  if (row.expiresAt && row.expiresAt <= now) return 'Este convite expirou.';
  if (row.maxUses > 0 && row.uses >= row.maxUses) return 'Este convite atingiu o limite de usos.';
  return null;
}

function toInvite(row: InviteRow, inviter: UserRow | undefined): GuildInvite {
  return {
    code: row.code,
    guildId: row.guildId,
    inviter: inviter
      ? { id: inviter.id, displayName: inviter.displayName, avatarUrl: inviter.avatarUrl }
      : null,
    uses: row.uses,
    maxUses: row.maxUses,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    active: inviteIsActive(row),
  };
}

export function createInvite(actorId: string, guildId: string, input: CreateInviteInput = {}): GuildInvite {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.CreateInvite, 'Você não pode criar convites.');

  const maxUses = input.maxUses ?? 0;
  if (!Number.isInteger(maxUses) || maxUses < 0 || maxUses > MAX_INVITE_USES) {
    throw badRequest(`O limite de usos deve ficar entre 0 e ${MAX_INVITE_USES} (0 = ilimitado).`);
  }
  const duration = input.durationMs ?? null;
  if (duration !== null) {
    if (!Number.isFinite(duration) || duration <= 0) throw badRequest('Duração do convite inválida.');
    if (duration > MAX_INVITE_DURATION_MS) throw badRequest('A duração máxima de um convite é 30 dias.');
  }

  const row: InviteRow = {
    code: newInviteCode(),
    guildId,
    inviterId: actorId,
    uses: 0,
    maxUses,
    expiresAt: duration === null ? null : new Date(Date.now() + duration).toISOString(),
    createdAt: nowIso(),
  };
  db.insert(schema.invites).values(row).run();
  recordAudit(guildId, actorId, { action: 'invite.create', targetId: row.code, targetName: row.code });

  const inviter = db.select().from(schema.users).where(eq(schema.users.id, actorId)).get();
  return toInvite(row, inviter);
}

/**
 * Lists the guild invites. Moderators (ManageGuild / ManageMembers / BanMembers /
 * ManageRoles) see every invite; everyone else only sees the ones they created.
 */
export function listInvites(guildId: string, viewerId: string): GuildInvite[] {
  const actor = actorContext(guildId, viewerId);
  const moderatorFlags =
    Permission.ManageGuild | Permission.ManageMembers | Permission.ManageRoles | Permission.BanMembers;
  const seesAll = (actor.permissions & moderatorFlags) !== 0 || actor.isOwner;

  const rows = db
    .select()
    .from(schema.invites)
    .where(seesAll ? eq(schema.invites.guildId, guildId) : and(eq(schema.invites.guildId, guildId), eq(schema.invites.inviterId, viewerId)))
    .orderBy(desc(schema.invites.createdAt))
    .all();

  const cache = new Map<string, UserRow | undefined>();
  const user = (id: string) => {
    if (!cache.has(id)) cache.set(id, db.select().from(schema.users).where(eq(schema.users.id, id)).get());
    return cache.get(id);
  };
  return rows.map((row) => toInvite(row, user(row.inviterId)));
}

/** Only the creator or someone holding ManageGuild may revoke an invite. */
export function revokeInvite(actorId: string, code: string): void {
  const row = db.select().from(schema.invites).where(eq(schema.invites.code, code)).get();
  // the same answer for an unknown code and for someone else's invite: the
  // status code must not reveal which codes exist
  const missing = hidden('Convite não encontrado.');
  if (!row) throw missing;
  const actor = actorContext(row.guildId, actorId);
  const canManage = actor.isOwner || (actor.permissions & Permission.ManageGuild) === Permission.ManageGuild;
  if (row.inviterId !== actorId && !canManage) throw missing;
  db.delete(schema.invites).where(eq(schema.invites.code, code)).run();
  recordAudit(row.guildId, actorId, { action: 'invite.revoke', targetId: code, targetName: code });
}

/**
 * Throws when the invite exists but can no longer be used. Unknown, expired and
 * exhausted codes all fail the same way, so the code space cannot be enumerated.
 */
export function requireRedeemableInvite(code: string): InviteRow {
  const row = db.select().from(schema.invites).where(eq(schema.invites.code, code.trim())).get();
  if (!row || inviteInactiveReason(row)) throw hidden('Convite inválido ou expirado.');
  return row;
}
