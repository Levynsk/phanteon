import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { GuildRoleEntity, MemberPermissions, RoleSummary } from '@phanteon/shared';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  MAX_ROLES_PER_GUILD,
  MAX_ROLE_NAME_LENGTH,
  Permission,
  hasPermission,
} from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import type { GuildRow, RoleRow } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { recordAudit } from './audit';

export const EVERYONE_ROLE_ID_PREFIX = 'everyone-';
export const ADMIN_ROLE_ID_PREFIX = 'admin-';
export const MEMBER_ROLE_ID_PREFIX = 'member-';

export function toRoleEntity(row: RoleRow): GuildRoleEntity {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    color: row.color,
    permissions: row.permissions,
    position: row.position,
    isEveryone: row.isEveryone,
    isSystem: row.isSystem,
    createdAt: row.createdAt,
  };
}

export function listRoles(guildId: string): GuildRoleEntity[] {
  return db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.guildId, guildId))
    .orderBy(desc(schema.roles.position), asc(schema.roles.createdAt))
    .all()
    .map(toRoleEntity);
}

export function listRolesWithCounts(guildId: string): RoleSummary[] {
  const counts = new Map<string, number>();
  for (const row of db
    .select({ roleId: schema.memberRoles.roleId })
    .from(schema.memberRoles)
    .where(eq(schema.memberRoles.guildId, guildId))
    .all()) {
    counts.set(row.roleId, (counts.get(row.roleId) ?? 0) + 1);
  }
  return listRoles(guildId).map((role) => ({ ...role, memberCount: counts.get(role.id) ?? 0 }));
}

export function getRoleOrThrow(guildId: string, roleId: string): RoleRow {
  const role = db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.id, roleId), eq(schema.roles.guildId, guildId)))
    .get();
  if (!role) throw notFound('Cargo não encontrado.');
  return role;
}

const ADMIN_PERMISSIONS =
  Permission.ViewChannel |
  Permission.CreateInvite |
  Permission.ManageGuild |
  Permission.ManageChannels |
  Permission.ManageRoles |
  Permission.ManageMembers |
  Permission.KickMembers |
  Permission.SendMessages |
  Permission.AttachFiles |
  Permission.AddReactions |
  Permission.ManageOwnMessages |
  Permission.ManageMessages |
  Permission.Connect |
  Permission.Speak |
  Permission.MuteMembers |
  Permission.MoveMembers |
  Permission.BanMembers |
  Permission.ViewAuditLog;

/**
 * Creates the system roles for a new guild: `@everyone`, `Administrador`
 * (everything except owning the server) and `Membro` (cosmetic, assigned to
 * nobody) so the settings screen starts with a useful hierarchy.
 */
export function createDefaultRoles(guild: GuildRow): void {
  const now = nowIso();
  db.insert(schema.roles)
    .values([
      {
        id: `${EVERYONE_ROLE_ID_PREFIX}${guild.id}`,
        guildId: guild.id,
        name: '@everyone',
        color: '#99aab5',
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        position: 0,
        isEveryone: true,
        isSystem: true,
        createdAt: now,
      },
      {
        id: `${ADMIN_ROLE_ID_PREFIX}${guild.id}`,
        guildId: guild.id,
        name: 'Administrador',
        color: '#fbbf24',
        permissions: ADMIN_PERMISSIONS,
        position: 2,
        isEveryone: false,
        isSystem: true,
        createdAt: now,
      },
      {
        id: `${MEMBER_ROLE_ID_PREFIX}${guild.id}`,
        guildId: guild.id,
        name: 'Membro',
        color: '#4ade80',
        permissions: 0,
        position: 1,
        isEveryone: false,
        isSystem: true,
        createdAt: now,
      },
    ])
    .run();
}

export const SYSTEM_ROLE_IDS = {
  everyone: (guildId: string) => `${EVERYONE_ROLE_ID_PREFIX}${guildId}`,
  admin: (guildId: string) => `${ADMIN_ROLE_ID_PREFIX}${guildId}`,
  member: (guildId: string) => `${MEMBER_ROLE_ID_PREFIX}${guildId}`,
} as const;

export interface ActorContext {
  guild: GuildRow;
  userId: string;
  isOwner: boolean;
  permissions: number;
  position: number;
  /** Role rows the actor holds, including @everyone implicitly. */
  roles: RoleRow[];
}

/** Everything a member can do in a guild, resolved once per request. */
export function resolveMemberPermissions(guild: GuildRow, userId: string): MemberPermissions {
  if (guild.ownerId === userId) {
    return { permissions: ALL_PERMISSIONS, isOwner: true, position: Number.MAX_SAFE_INTEGER };
  }

  const everyone = db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guild.id), eq(schema.roles.isEveryone, true)))
    .get();

  const assigned = memberRolesOf(guild.id, userId);
  const roles = [...assigned, ...(everyone ? [everyone] : [])];

  let permissions = 0;
  let position = 0;
  for (const role of roles) {
    permissions |= role.permissions;
    position = Math.max(position, role.position);
  }

  return { permissions, isOwner: false, position };
}

/** Overrides stored for one channel, keyed by role id (`EVERYONE_OVERRIDE_ID` for @everyone). */
export const EVERYONE_OVERRIDE_ID = '@everyone';

/** Every role column, for joins where a bare `schema.roles` would clash with `member_roles.id`. */
export const roleColumns = {
  id: schema.roles.id,
  guildId: schema.roles.guildId,
  name: schema.roles.name,
  color: schema.roles.color,
  permissions: schema.roles.permissions,
  position: schema.roles.position,
  isEveryone: schema.roles.isEveryone,
  isSystem: schema.roles.isSystem,
  createdAt: schema.roles.createdAt,
};

export function channelOverridesFor(channelId: string): { roleId: string; allow: number; deny: number }[] {
  return db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channelId)).all();
}

/**

 * Effective channel permissions: guild permissions, then @everyone override,
 * then overrides for each of the member's roles (allow and deny are unioned,
 * and deny always wins over allow), like Discord.
 */
export function resolveChannelPermissions(guild: GuildRow, channelId: string, userId: string): number {
  // outsiders hold nothing, even if @everyone grants it
  const membership = db
    .select()
    .from(schema.guildMembers)
    .where(and(eq(schema.guildMembers.guildId, guild.id), eq(schema.guildMembers.userId, userId)))
    .get();
  if (!membership) return 0;

  const base = resolveMemberPermissions(guild, userId);
  if (base.isOwner) return base.permissions;

  const everyoneRole = db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guild.id), eq(schema.roles.isEveryone, true)))
    .get();
  const assigned = memberRolesOf(guild.id, userId);
  const roleIds = new Set(assigned.map((role) => role.id));
  if (everyoneRole) roleIds.add(everyoneRole.id);

  // a channel inside a category also honours the category's overrides
  const channelRow = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  const sources = channelRow?.categoryId ? [channelRow.categoryId, channelId] : [channelId];
  const overrides = sources.flatMap((sourceId) => channelOverridesFor(sourceId));

  const everyoneOverride = overrides.find(
    (override) => override.roleId === EVERYONE_OVERRIDE_ID || (everyoneRole && override.roleId === everyoneRole.id),
  );
  let permissions = everyoneOverride
    ? (base.permissions & ~everyoneOverride.deny) | everyoneOverride.allow
    : base.permissions;

  let allow = 0;
  let deny = 0;
  for (const override of overrides) {
    if (!roleIds.has(override.roleId)) continue;
    allow |= override.allow;
    deny |= override.deny;
  }
  permissions = (permissions & ~deny) | allow;

  // roles carry their own grants; a channel deny above still wins
  for (const role of assigned) permissions |= role.permissions & ~deny;

  return permissions;
}

export function assertCanBeginVoice(guildId: string, channelId: string, userId: string, flag: number, message: string): void {
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).get();
  if (!guild) throw notFound('Servidor não encontrado.');
  const permissions = resolveChannelPermissions(guild, channelId, userId);
  if ((permissions & flag) !== flag) throw forbidden(message);
}

export function memberRolesOf(guildId: string, userId: string): RoleRow[] {
  // select the role fields explicitly: spreading both sides lets member_roles.id win
  const rows = db
    .select({ role: roleColumns })
    .from(schema.memberRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.memberRoles.roleId))
    .where(and(eq(schema.memberRoles.guildId, guildId), eq(schema.memberRoles.userId, userId)))
    .all();
  return rows.map((row) => row.role).sort((a, b) => b.position - a.position);
}

/** Role ids for every member of a guild, used to decorate member lists. */
export function memberRoleMap(guildId: string): Map<string, RoleRow[]> {
  const rows = db
    .select({ userId: schema.memberRoles.userId, role: roleColumns })
    .from(schema.memberRoles)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.memberRoles.roleId))
    .where(eq(schema.memberRoles.guildId, guildId))
    .all();

  const map = new Map<string, RoleRow[]>();
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(row.role);
    map.set(row.userId, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.position - a.position);
  return map;
}

export function actorContext(guildId: string, userId: string): ActorContext {
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).get();
  if (!guild) throw notFound('Servidor não encontrado.');
  const membership = db
    .select()
    .from(schema.guildMembers)
    .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)))
    .get();
  if (!membership) throw forbidden('Você não é membro deste servidor.');
  const resolved = resolveMemberPermissions(guild, userId);
  return {
    guild,
    userId,
    isOwner: resolved.isOwner,
    permissions: resolved.permissions,
    position: resolved.position,
    roles: memberRolesOf(guildId, userId),
  };
}

export function requirePermission(actor: ActorContext, flag: number, message: string): void {
  if (!hasPermission(actor.permissions, flag as never)) throw forbidden(message);
}

/** Whether the actor outranks a target member (owner always wins). */
export function canActOn(actor: ActorContext, targetUserId: string): boolean {
  if (actor.isOwner) return true;
  if (targetUserId === actor.guild.ownerId) return false;
  const target = resolveMemberPermissions(actor.guild, targetUserId);
  return target.position < actor.position;
}

function assertRoleBelowActor(actor: ActorContext, role: RoleRow): void {
  if (actor.isOwner) return;
  if (role.isEveryone) throw forbidden('O cargo @everyone não pode ser alterado por membros.');
  if (role.position >= actor.position) throw forbidden('Você só pode alterar cargos abaixo do seu.');
}

/**
 * A role must not reach further than its editor does: an override naming a
 * channel the editor cannot see, or granting a permission the editor does not
 * hold, would be a way around ManageChannels / the permission they were given.
 */
function assertRoleReach(guild: GuildRow, actor: ActorContext, roleId: string, permissions: number): void {
  if (actor.isOwner) return;
  if ((permissions & ~actor.permissions) !== 0) {
    throw forbidden('Você não pode conceder permissões que você não possui.');
  }
  const overrides = db.select().from(schema.channelOverrides).where(eq(schema.channelOverrides.roleId, roleId)).all();
  for (const override of overrides) {
    const channel = db.select().from(schema.channels).where(eq(schema.channels.id, override.channelId)).get();
    if (!channel) continue;
    const visible = (resolveChannelPermissions(guild, channel.id, actor.userId) & Permission.ViewChannel) !== 0;
    if (!visible) throw forbidden('Você não pode alterar cargos de canais que você não vê.');
  }
}

function broadcastRoles(guildId: string): GuildRoleEntity[] {
  const roles = listRoles(guildId);
  hub.emitToUsers(guildMemberIds(guildId), { type: 'guild:roles', guildId, roles });
  return roles;
}

function broadcastMemberRoles(guildId: string, userId: string): void {
  const roles = memberRolesOf(guildId, userId);
  hub.emitToUsers(guildMemberIds(guildId), {
    type: 'member:roles',
    guildId,
    userId,
    roleIds: roles.map((role) => role.id),
    position: roles[0]?.position ?? 0,
  });
}

export interface CreateRoleInput {
  name: string;
  color?: string;
  permissions?: number;
}

export function createRole(guildId: string, actorId: string, input: CreateRoleInput): GuildRoleEntity {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageRoles, 'Você não pode gerenciar cargos.');

  const existing = listRoles(guildId);
  if (existing.length >= MAX_ROLES_PER_GUILD) {
    throw conflict(`Um servidor pode ter no máximo ${MAX_ROLES_PER_GUILD} cargos.`);
  }

  const name = input.name.trim();
  if (!name) throw badRequest('Informe o nome do cargo.');
  if (name.length > MAX_ROLE_NAME_LENGTH) throw badRequest('Nome de cargo muito longo.');
  if (existing.some((role) => !role.isEveryone && role.name.toLowerCase() === name.toLowerCase())) {
    throw conflict('Já existe um cargo com esse nome.');
  }

  const highest = existing.filter((role) => !role.isEveryone).reduce((acc, role) => Math.max(acc, role.position), 0);
  const maxPosition = actor.isOwner ? highest + 1 : Math.min(actor.position, highest + 1);
  const requested = input.permissions ?? 0;
  // a non-owner can never grant permissions they don't have
  const permissions = actor.isOwner ? requested : requested & actor.permissions;

  const row: RoleRow = {
    id: newId(),
    guildId,
    name,
    color: input.color ?? '#a1a1aa',
    permissions,
    position: maxPosition,
    isEveryone: false,
    isSystem: false,
    createdAt: nowIso(),
  };
  db.insert(schema.roles).values(row).run();
  recordAudit(guildId, actorId, { action: 'role.create', targetId: row.id, targetName: row.name });
  broadcastRoles(guildId);
  return toRoleEntity(row);
}

export interface UpdateRoleInput {
  name?: string;
  color?: string;
  permissions?: number;
}

export function updateRole(guildId: string, actorId: string, roleId: string, input: UpdateRoleInput): GuildRoleEntity {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageRoles, 'Você não pode gerenciar cargos.');
  const role = getRoleOrThrow(guildId, roleId);

  // @everyone sits below every role, so anyone who can manage roles may edit it,
  // but only the owner can grant permissions @everyone shouldn't have
  if (!role.isEveryone) assertRoleBelowActor(actor, role);

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw badRequest('Informe o nome do cargo.');
    if (name.length > MAX_ROLE_NAME_LENGTH) throw badRequest('Nome de cargo muito longo.');
  }
  if (input.permissions !== undefined && !actor.isOwner) {
    const escalated = input.permissions & ~actor.permissions;
    if (escalated !== 0) throw forbidden('Você não pode conceder permissões que você não possui.');
  }
  if (input.name !== undefined && role.isEveryone) {
    throw badRequest('O cargo @everyone não pode ser renomeado.');
  }
  assertRoleReach(actor.guild, actor, role.id, input.permissions ?? role.permissions);

  const updated = db
    .update(schema.roles)
    .set({
      name: input.name !== undefined ? input.name.trim() : role.name,
      color: input.color ?? role.color,
      permissions: input.permissions ?? role.permissions,
    })
    .where(eq(schema.roles.id, roleId))
    .returning()
    .get();

  recordAudit(guildId, actorId, { action: 'role.update', targetId: updated.id, targetName: updated.name });
  broadcastRoles(guildId);
  return toRoleEntity(updated);
}

export function deleteRole(guildId: string, actorId: string, roleId: string): void {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageRoles, 'Você não pode gerenciar cargos.');
  // deleting a role that is already gone is a success: a double click or a
  // duplicate request should not surface an error for an outcome that happened
  const role = db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.id, roleId), eq(schema.roles.guildId, guildId)))
    .get();
  if (!role) return;
  if (role.isEveryone) throw forbidden('O cargo @everyone não pode ser excluído.');
  if (role.isSystem) throw forbidden('Cargos do sistema não podem ser excluídos.');
  assertRoleBelowActor(actor, role);

  db.delete(schema.roles).where(eq(schema.roles.id, roleId)).run();
  recordAudit(guildId, actorId, { action: 'role.delete', targetId: roleId, targetName: role.name });
  broadcastRoles(guildId);
  for (const memberId of guildMemberIds(guildId)) broadcastMemberRoles(guildId, memberId);
}

export function reorderRoles(guildId: string, actorId: string, orderedIds: string[]): GuildRoleEntity[] {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageRoles, 'Você não pode gerenciar cargos.');

  const roles = listRoles(guildId);
  const managed = roles.filter((role) => !role.isEveryone);
  if (orderedIds.length !== managed.length) throw badRequest('A lista de cargos está incompleta.');

  const byId = new Map(managed.map((role) => [role.id, role]));
  for (const id of orderedIds) {
    if (!byId.has(id)) throw badRequest('Cargo inválido na ordem enviada.');
  }

  // highest first in the list, so position = total - index
  const positionById = new Map(orderedIds.map((id, index) => [id, orderedIds.length - index]));

  if (!actor.isOwner) {
    for (const role of managed) {
      const next = positionById.get(role.id)!;
      const cannotTouch = role.position >= actor.position;
      if (cannotTouch && next !== role.position) {
        throw forbidden('Você não pode mover cargos acima do seu.');
      }
      if (!cannotTouch && next >= actor.position) {
        throw forbidden('Você não pode mover cargos para acima do seu.');
      }
    }
  }

  db.transaction((tx) => {
    for (const [id, position] of positionById) {
      tx.update(schema.roles).set({ position }).where(eq(schema.roles.id, id)).run();
    }
  });

  return broadcastRoles(guildId);
}

export function setMemberRoles(guildId: string, actorId: string, targetUserId: string, roleIds: string[]): void {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageMembers, 'Você não pode atribuir cargos.');
  // the owner already holds every permission; their roles are cosmetic,
  // so only the owner themselves may change which roles they wear
  if (targetUserId === actor.guild.ownerId && !actor.isOwner) {
    throw forbidden('Não é possível alterar os cargos do dono.');
  }

  const unique = [...new Set(roleIds)];
  const roles = unique.length
    ? db
        .select()
        .from(schema.roles)
        .where(and(eq(schema.roles.guildId, guildId), inArray(schema.roles.id, unique)))
        .all()
    : [];
  if (roles.length !== unique.length) throw badRequest('Um dos cargos não pertence a este servidor.');

  const assignable = roles.filter((role) => !role.isEveryone);
  for (const role of assignable) {
    if (!canActOn(actor, targetUserId) || (!actor.isOwner && role.position >= actor.position)) {
      throw forbidden('Você só pode atribuir cargos abaixo do seu.');
    }
    assertRoleReach(actor.guild, actor, role.id, role.permissions);
  }

  db.transaction((tx) => {
    tx.delete(schema.memberRoles)
      .where(and(eq(schema.memberRoles.guildId, guildId), eq(schema.memberRoles.userId, targetUserId)))
      .run();
    if (assignable.length > 0) {
      tx.insert(schema.memberRoles)
        .values(assignable.map((role) => ({ guildId, userId: targetUserId, roleId: role.id })))
        .run();
    }
  });

  const target = db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).get();
  recordAudit(guildId, actorId, {
    action: 'member.roles',
    targetId: targetUserId,
    targetName: target?.displayName ?? null,
  });
  broadcastMemberRoles(guildId, targetUserId);
}

export function findEveryoneRole(guildId: string): RoleRow | undefined {
  return db
    .select()
    .from(schema.roles)
    .where(and(eq(schema.roles.guildId, guildId), eq(schema.roles.isEveryone, true)))
    .get();
}
