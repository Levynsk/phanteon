import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Channel, GuildRoleEntity } from '@phanteon/shared';
import { channelSlug, MAX_CHANNEL_NAME_LENGTH, Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toChannel } from '../db/mappers';
import type { ChannelRow } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { recordAudit } from './audit';
import { EVERYONE_OVERRIDE_ID, actorContext, listRoles, requirePermission, resolveChannelPermissions } from './roles';
import { requireMembership } from './guilds';

export const MAX_CATEGORIES = 50;

export type ChannelVisibility = 'public' | 'private';

export interface CategoryInput {
  name: string;
  /** Roles allowed to see it when private; ignored when public. */
  roleIds?: string[];
  visibility?: ChannelVisibility;
}

function guildChannels(guildId: string): ChannelRow[] {
  return db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, 'guild'), eq(schema.channels.guildId, guildId)))
    .orderBy(asc(schema.channels.position))
    .all();
}

function categoryRow(guildId: string, categoryId: string): ChannelRow {
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, categoryId)).get();
  if (!row || row.guildId !== guildId || row.type !== 'category') throw notFound('Categoria não encontrada.');
  return row;
}

/** Rewrites the overrides for one channel and keeps the `@everyone` delegate in sync. */
function writeOverrides(channelId: string, overrides: { roleId: string; allow: number; deny: number }[]): boolean {
  db.delete(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channelId)).run();
  for (const override of overrides) {
    if (override.allow === 0 && override.deny === 0) continue;
    db.insert(schema.channelOverrides)
      .values({ channelId, roleId: override.roleId, allow: override.allow, deny: override.deny })
      .run();
  }
  const everyone = overrides.find((override) => override.roleId === EVERYONE_OVERRIDE_ID);
  return Boolean(everyone && (everyone.deny & Permission.ViewChannel) === Permission.ViewChannel);
}

/**
 * Public: every role that holds ViewChannel keeps it (we only clear our own old
 * denials). Private: @everyone loses ViewChannel and the listed roles get it back.
 */
type Override = { roleId: string; allow: number; deny: number };

function visibilityOverrides(roleIds: string[], visibility: ChannelVisibility, base: Override[] = []): Override[] {
  const kept = base.filter((override) => override.roleId !== EVERYONE_OVERRIDE_ID);
  const byRole = new Set(roleIds);
  const roleOverrides: Override[] = kept.map((override) => {
    if (!byRole.has(override.roleId)) return override;
    return { ...override, allow: override.allow | Permission.ViewChannel };
  });
  if (visibility === 'public') {
    return [
      { roleId: EVERYONE_OVERRIDE_ID, allow: 0, deny: 0 },
      ...roleOverrides,
    ];
  }
  const existingRoles = new Set(kept.map((override) => override.roleId));
  for (const roleId of roleIds) {
    if (!existingRoles.has(roleId)) roleOverrides.push({ roleId, allow: Permission.ViewChannel, deny: 0 });
  }
  return [
    { roleId: EVERYONE_OVERRIDE_ID, allow: 0, deny: Permission.ViewChannel },
    ...roleOverrides,
  ];
}

function validateRoleIds(guildId: string, roleIds: string[]): string[] {
  const unique = [...new Set(roleIds)].filter((id) => id !== EVERYONE_OVERRIDE_ID);
  if (unique.length === 0) return [];
  const rows = db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guildId), inArray(schema.roles.id, unique)))
    .all();
  if (rows.length !== unique.length) throw badRequest('Um dos cargos não pertence a este servidor.');
  return unique;
}

/** Overrides stored on a category or channel, as stored (role + allow/deny). */
export function listCategoryRoles(categoryId: string): Override[] {
  return db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, categoryId)).all();
}

export function createCategory(guildId: string, actorId: string, input: CategoryInput): Channel {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode criar categorias.');
  const categories = guildChannels(guildId).filter((row) => row.type === 'category');
  if (categories.length >= MAX_CATEGORIES) throw conflict(`Um servidor pode ter no máximo ${MAX_CATEGORIES} categorias.`);

  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome da categoria.');
  if (name.length > MAX_CHANNEL_NAME_LENGTH) throw badRequest('Nome de categoria muito longo.');

  const last = guildChannels(guildId).at(-1);
  const roleIds = validateRoleIds(guildId, input.roleIds ?? []);
  const visibility = input.visibility ?? (roleIds.length > 0 ? 'private' : 'public');

  const row: ChannelRow = {
    id: newId(),
    kind: 'guild',
    guildId,
    name,
    topic: null,
    type: 'category',
    position: (last?.position ?? 0) + 1,
    userLimit: 0,
    categoryId: null,
    private: visibility === 'private',
    createdAt: nowIso(),
  };
  db.insert(schema.channels).values(row).run();
  writeOverrides(row.id, visibilityOverrides(roleIds, visibility));
  row.private = visibility === 'private';

  const channel = toChannel(row);
  recordAudit(guildId, actorId, { action: 'channel.create', targetId: channel.id, targetName: channel.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:create', channel });
  hub.syncUserRoomsForGuild(guildId);
  return channel;
}

export function updateCategory(guildId: string, actorId: string, categoryId: string, input: CategoryInput): Channel {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode editar categorias.');
  const row = categoryRow(guildId, categoryId);

  const name = input.name?.trim() ?? row.name;
  if (!name) throw badRequest('Informe o nome da categoria.');
  if (name.length > MAX_CHANNEL_NAME_LENGTH) throw badRequest('Nome de categoria muito longo.');

  const updated = db.update(schema.channels).set({ name }).where(eq(schema.channels.id, categoryId)).returning().get();

  let isPrivate = row.private;
  if (input.roleIds !== undefined || input.visibility !== undefined) {
    const roleIds = validateRoleIds(guildId, input.roleIds ?? []);
    const visibility = input.visibility ?? (isPrivate ? 'private' : 'public');
    const base: Override[] =
      input.roleIds === undefined
        ? listCategoryRoles(categoryId).filter((override) => override.roleId !== EVERYONE_OVERRIDE_ID)
        : [];
    isPrivate = writeOverrides(categoryId, visibilityOverrides(roleIds, visibility, base));
    db.update(schema.channels).set({ private: isPrivate }).where(eq(schema.channels.id, categoryId)).run();
  }

  const channel = toChannel({ ...updated, private: isPrivate });
  recordAudit(guildId, actorId, { action: 'channel.update', targetId: categoryId, targetName: channel.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:update', channel });
  // children inherit the category overrides, so their memberships must be re-synced
  hub.syncUserRoomsForGuild(guildId);
  return channel;
}

export function deleteCategory(guildId: string, actorId: string, categoryId: string): void {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode excluir categorias.');
  const row = categoryRow(guildId, categoryId);

  // children are kept: Discord moves them to the top level instead of deleting them
  const children = guildChannels(guildId).filter((entry) => entry.categoryId === categoryId);
  db.update(schema.channels)
    .set({ categoryId: null, position: row.position + children.length + 1 })
    .where(eq(schema.channels.categoryId, categoryId))
    .run();
  db.delete(schema.channels).where(eq(schema.channels.id, categoryId)).run();

  recordAudit(guildId, actorId, { action: 'channel.delete', targetId: categoryId, targetName: row.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:delete', channelId: categoryId, guildId });
  for (const child of children) {
    hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:update', channel: toChannel({ ...child, categoryId: null }) });
  }
  hub.syncUserRoomsForGuild(guildId);
}

export interface ChannelAccessInput {
  /** `public` clears the @everyone deny; `private` hides it from @everyone. */
  visibility?: ChannelVisibility;
  /** Roles allowed to see the channel when private. */
  roleIds?: string[];
  categoryId?: string | null;
  name?: string;
  topic?: string | null;
  userLimit?: number;
}

/** Visibility, role access, rename and category assignment for one channel or category. */
export function updateChannelAccess(
  guildId: string,
  actorId: string,
  channelId: string,
  input: ChannelAccessInput,
): Channel {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode gerenciar canais.');
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!row || row.guildId !== guildId || row.kind !== 'guild') throw notFound('Canal não encontrado.');
  // managing channels does not reveal a channel: its visibility is out of reach without ViewChannel
  const visible =
    (resolveChannelPermissions(actor.guild, channelId, actorId) & Permission.ViewChannel) !== 0 ||
    (row.categoryId !== null && (resolveChannelPermissions(actor.guild, row.categoryId, actorId) & Permission.ViewChannel) !== 0);
  if (!visible) throw forbidden('Você não tem acesso a este canal.');

  const patch: Partial<ChannelRow> = {};
  let touched = false;
  if (input.name !== undefined) {
    const name = channelSlug(input.name) || input.name.trim();
    if (!name) throw badRequest('Nome de canal inválido.');
    if (name.length > MAX_CHANNEL_NAME_LENGTH) throw badRequest('Nome de canal muito longo.');
    patch.name = row.type === 'category' ? input.name.trim() : name;
  }
  if (input.topic !== undefined) patch.topic = input.topic?.trim() || null;
  if (input.userLimit !== undefined) {
    if (!Number.isInteger(input.userLimit) || input.userLimit < 0 || input.userLimit > 99) {
      throw badRequest('O limite de usuários deve ficar entre 0 e 99.');
    }
    if (row.type !== 'voice' && input.userLimit > 0) throw badRequest('Só canais de voz têm limite de usuários.');
    patch.userLimit = input.userLimit;
  }
  if (input.categoryId !== undefined) {
    if (input.categoryId) {
      const category = categoryRow(guildId, input.categoryId);
      if (category.id === row.id) throw badRequest('Uma categoria não pode conter a si mesma.');
    }
    patch.categoryId = input.categoryId;
  }

  let isPrivate = row.private;
  if (input.visibility !== undefined || input.roleIds !== undefined) {
    const current = db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channelId)).all();
    const roleIds = validateRoleIds(guildId, input.roleIds ?? current.filter((o) => o.roleId !== EVERYONE_OVERRIDE_ID && (o.allow & Permission.ViewChannel) !== 0).map((o) => o.roleId));
    const visibility = input.visibility ?? (isPrivate ? 'private' : 'public');
    const keepOthers = current
      .filter((o) => o.roleId !== EVERYONE_OVERRIDE_ID && !roleIds.includes(o.roleId))
      .map((o) => ({ roleId: o.roleId, allow: o.allow & ~Permission.ViewChannel, deny: o.deny }));
    isPrivate = writeOverrides(channelId, [...visibilityOverrides(roleIds, visibility), ...keepOthers.filter((o) => o.allow || o.deny)]);
    patch.private = isPrivate;
    // the overrides were written as a side effect, so changing only name/topic must not skip a sync
    touched = true;
  }

  if (Object.keys(patch).length === 0 && !touched) return toChannel(row);
  const updated = Object.keys(patch).length > 0
    ? db.update(schema.channels).set(patch).where(eq(schema.channels.id, channelId)).returning().get()
    : row;

  const channel = toChannel(updated);
  recordAudit(guildId, actorId, { action: 'channel.update', targetId: channel.id, targetName: channel.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:update', channel });
  hub.syncUserRoomsForGuild(guildId);
  return channel;
}

/** Pushes the category's visibility rules onto every child channel (Discord's default). */
export function syncCategoryPermissions(guildId: string, actorId: string, categoryId: string): Channel[] {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode sincronizar permissões.');
  const category = categoryRow(guildId, categoryId);
  const overrides = listCategoryRoles(categoryId);
  const children = guildChannels(guildId).filter((row) => row.categoryId === categoryId);

  const updatedChannels: Channel[] = [];
  db.transaction((tx) => {
    for (const child of children) {
      tx.delete(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, child.id)).run();
      for (const override of overrides) {
        tx.insert(schema.channelOverrides)
          .values({ channelId: child.id, roleId: override.roleId, allow: override.allow, deny: override.deny })
          .run();
      }
      const updated = tx
        .update(schema.channels)
        .set({ private: category.private })
        .where(eq(schema.channels.id, child.id))
        .returning()
        .get();
      updatedChannels.push(toChannel(updated));
    }
  });

  recordAudit(guildId, actorId, { action: 'channel.update', targetId: categoryId, targetName: `${category.name} (permissões sincronizadas)` });
  for (const channel of updatedChannels) hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:update', channel });
  hub.syncUserRoomsForGuild(guildId);
  return updatedChannels;
}

export interface ChannelOrderItem {
  id: string;
  categoryId: string | null;
}

/** Writes positions for every channel, in list order; categories first in their own list. */
export function reorderChannels(guildId: string, actorId: string, items: ChannelOrderItem[]): Channel[] {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode reordenar canais.');
  const rows = guildChannels(guildId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (items.length !== rows.length) throw badRequest('A lista de canais está incompleta.');

  const updated: Channel[] = [];
  db.transaction((tx) => {
    items.forEach((item, index) => {
      const row = byId.get(item.id);
      if (!row) throw badRequest('Canal inválido na ordem enviada.');
      if (item.categoryId) categoryRow(guildId, item.categoryId);
      const next = tx
        .update(schema.channels)
        .set({ position: index, categoryId: item.categoryId })
        .where(eq(schema.channels.id, item.id))
        .returning()
        .get();
      updated.push(toChannel(next));
    });
  });

  for (const channel of updated) hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:update', channel });
  hub.syncUserRoomsForGuild(guildId);
  return updated;
}

/**
 * Titles and roles used by the settings screen. Only members may ask: it lists
 * every role and channel of the server.
 */
export function categoryDetails(guildId: string, viewerId: string): { categories: Channel[]; roles: GuildRoleEntity[] } {
  requireMembership(guildId, viewerId);
  const categories = guildChannels(guildId).filter((row) => row.type === 'category').map(toChannel);
  return { categories, roles: listRoles(guildId) };
}
