import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { AuditLogEntry } from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { badRequest } from '../http/errors';
import { actorContext, requirePermission } from './roles';

/** Actions recorded in the guild audit log. */
export const AUDIT_ACTIONS = [
  'member.kick',
  'member.ban',
  'member.unban',
  'member.roles',
  'channel.create',
  'channel.update',
  'channel.delete',
  'role.create',
  'role.update',
  'role.delete',
  'guild.update',
  'invite.create',
  'invite.revoke',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'member.kick': 'Expulsou um membro',
  'member.ban': 'Banou um membro',
  'member.unban': 'Revogou um banimento',
  'member.roles': 'Alterou cargos de um membro',
  'channel.create': 'Criou um canal',
  'channel.update': 'Editou um canal',
  'channel.delete': 'Excluiu um canal',
  'role.create': 'Criou um cargo',
  'role.update': 'Editou um cargo',
  'role.delete': 'Excluiu um cargo',
  'guild.update': 'Editou o servidor',
  'invite.create': 'Criou um convite',
  'invite.revoke': 'Revogou um convite',
};

export interface AuditInput {
  action: AuditAction;
  targetId?: string | null;
  targetName?: string | null;
  reason?: string | null;
}

/**
 * Appends an audit entry. Never throws into the caller's path: a broken log
 * must not roll back the action that was already applied.
 */
export function recordAudit(guildId: string, actorId: string, input: AuditInput): void {
  try {
    db.insert(schema.auditLogs)
      .values({
        id: newId(),
        guildId,
        actorId,
        action: input.action,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        reason: input.reason?.trim() || null,
        createdAt: nowIso(),
      })
      .run();
  } catch (error) {
    console.error('[audit] failed to record', input.action, error);
  }
}

export interface AuditPage {
  entries: AuditLogEntry[];
  /** Cursor for the next page, null when the list is exhausted. */
  nextCursor: string | null;
  total: number;
}

/** Newest first, optionally filtered by action and/or target user. */
export function listAuditLogs(
  guildId: string,
  viewerId: string,
  options: { action?: string; targetId?: string; before?: string; limit?: number } = {},
): AuditPage {
  const actor = actorContext(guildId, viewerId);
  requirePermission(actor, Permission.ViewAuditLog, 'Você não pode ver os logs de auditoria.');

  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  if (options.action && !(AUDIT_ACTIONS as readonly string[]).includes(options.action)) {
    throw badRequest('Ação de auditoria desconhecida.');
  }

  const filters = [eq(schema.auditLogs.guildId, guildId)];
  if (options.action) filters.push(eq(schema.auditLogs.action, options.action));
  if (options.targetId) filters.push(eq(schema.auditLogs.targetId, options.targetId));
  if (options.before) {
    const anchor = db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, options.before)).get();
    if (!anchor) throw badRequest('Cursor de paginação inválido.');
    filters.push(lt(schema.auditLogs.createdAt, anchor.createdAt));
  }

  const rows = db
    .select({ entry: schema.auditLogs, actor: schema.users })
    .from(schema.auditLogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
    .where(and(...filters))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const total = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.guildId, guildId),
        options.action ? eq(schema.auditLogs.action, options.action) : undefined,
        options.targetId ? eq(schema.auditLogs.targetId, options.targetId) : undefined,
      ),
    )
    .get();

  return {
    entries: page.map(({ entry, actor: author }) => ({
      id: entry.id,
      guildId: entry.guildId,
      actor: { id: author.id, displayName: author.displayName, avatarUrl: author.avatarUrl },
      action: entry.action,
      targetId: entry.targetId,
      targetName: entry.targetName,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.entry.id : null,
    total: Number(total?.count ?? 0),
  };
}
