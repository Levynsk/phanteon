import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type {
  Channel,
  GuildMember,
  GuildSummary,
  GuildWithDetails,
  GuildRole,
  GuildRoleEntity,
} from '@phanteon/shared';
import {
  channelSlug,
  MAX_CHANNEL_NAME_LENGTH,
  MAX_GUILD_DESCRIPTION_LENGTH,
  MAX_GUILD_NAME_LENGTH,
  Permission,
} from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toChannel, toGuildMember, toGuildSummary, toGuildWithDetails } from '../db/mappers';
import type { ChannelRow, GuildRow, UserRow } from '../db/schema';
import { badRequest, conflict, forbidden, hidden, notFound } from '../http/errors';
import { channelAudience, guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { forceLeaveGuildVoice } from './voice';
import { deleteUploadedFiles } from './uploads';
import { isBanned } from './bans';
import { requireRedeemableInvite } from './invites';
import { recordAudit } from './audit';
import { pickColor } from './users';
import {
  EVERYONE_OVERRIDE_ID,
  SYSTEM_ROLE_IDS,
  actorContext,
  canActOn,
  createDefaultRoles,
  listRoles,
  getRoleOrThrow,
  memberRoleMap,
  memberRolesOf,
  requirePermission,
  resolveChannelPermissions,
  resolveMemberPermissions,
  setMemberRoles,
} from './roles';
import type { ActorContext } from './roles';

export function getGuildRow(guildId: string): GuildRow {
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).get();
  if (!guild) throw notFound('Servidor não encontrado.');
  return guild;
}

export function getMembership(guildId: string, userId: string) {
  return db
    .select()
    .from(schema.guildMembers)
    .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)))
    .get();
}

export function requireMembership(guildId: string, userId: string) {
  const member = getMembership(guildId, userId);
  if (!member) throw forbidden('Você não é membro deste servidor.');
  return member;
}

/** Resolves the actor with permissions already evaluated. */
export function requireActor(guildId: string, userId: string): ActorContext {
  return actorContext(guildId, userId);
}

export function canManage(guildId: string, userId: string, flag: number = Permission.ManageChannels): boolean {
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).get();
  if (!guild) return false;
  const { permissions } = resolveMemberPermissions(guild, userId);
  return (permissions & flag) === flag;
}

export function listGuildsForUser(userId: string, origin = ''): GuildSummary[] {
  return db
    .select({ guild: schema.guilds })
    .from(schema.guilds)
    .innerJoin(schema.guildMembers, eq(schema.guildMembers.guildId, schema.guilds.id))
    .where(eq(schema.guildMembers.userId, userId))
    .orderBy(asc(schema.guilds.createdAt))
    .all()
    .map(({ guild }) => toGuildSummary(guild, origin));
}

export function listMembers(guildId: string, roleMap = memberRoleMap(guildId)): GuildMember[] {
  return db
    .select({ member: schema.guildMembers, user: schema.users })
    .from(schema.guildMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.guildMembers.userId))
    .where(eq(schema.guildMembers.guildId, guildId))
    .orderBy(asc(schema.guildMembers.joinedAt))
    .all()
    .map(({ member, user }) => {
      const roles = roleMap.get(user.id) ?? [];
      return toGuildMember(
        member,
        user,
        hub.isUserOnline(user.id),
        roles.map((role) => role.id),
        roles[0]?.position ?? 0,
      );
    });
}

export function getGuildDetails(guildId: string, viewerId: string, origin = ''): GuildWithDetails {
  const guild = getGuildRow(guildId);
  requireMembership(guildId, viewerId);
  const channels = db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, 'guild'), eq(schema.channels.guildId, guildId)))
    .orderBy(asc(schema.channels.position), asc(schema.channels.createdAt))
    .all();
  const resolved = resolveMemberPermissions(guild, viewerId);
  // re-resolving as the owner short-circuits the per-channel overrides
  const visible = resolved.isOwner
    ? channels
    : channels.filter(
        (channel) =>
          channel.type === 'category' ||
          (resolveChannelPermissions(guild, channel.id, viewerId) & Permission.ViewChannel) !== 0,
      );
  return toGuildWithDetails(
    guild,
    visible,
    listMembers(guildId),
    listRoles(guildId),
    { permissions: resolved.permissions, isOwner: resolved.isOwner },
    origin,
  );
}

export function createGuild(owner: UserRow, input: { name: string }, origin = ''): GuildWithDetails {
  const name = input.name.trim();
  if (!name) throw badRequest('O nome do servidor é obrigatório.');
  if (name.length > MAX_GUILD_NAME_LENGTH) throw badRequest('Nome de servidor muito longo.');

  const guildId = newId();
  const now = nowIso();

  const guild = db.transaction((tx) => {
    const row: GuildRow = {
      id: guildId,
      name,
      description: null,
      iconUrl: null,
      bannerUrl: null,
      iconColor: pickColor(name),
      ownerId: owner.id,
      createdAt: now,
    };
    tx.insert(schema.guilds).values(row).run();
    tx.insert(schema.guildMembers)
      .values({ guildId, userId: owner.id, role: 'owner', joinedAt: now })
      .run();
    return row;
  });

  createDefaultRoles(guild);
  const general = createChannel(guildId, owner.id, { name: 'geral', type: 'text' });

  const details = getGuildDetails(guildId, owner.id, origin);
  hub.emitToUsers([owner.id], { type: 'guild:create', guild: details });
  hub.emitToUsers([owner.id], { type: 'channel:create', channel: general });
  hub.emitToUsers([owner.id], { type: 'guild:roles', guildId, roles: details.roles });
  hub.syncUserRooms(owner.id);
  return details;
}

export interface UpdateGuildInput {
  name?: string;
  description?: string | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  iconColor?: string;
}

export function updateGuild(actorId: string, guildId: string, input: UpdateGuildInput, origin = ''): GuildSummary {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageGuild, 'Você não pode editar as configurações do servidor.');
  const guild = actor.guild;

  const name = input.name?.trim();
  if (name !== undefined) {
    if (!name) throw badRequest('O nome do servidor não pode ficar vazio.');
    if (name.length > MAX_GUILD_NAME_LENGTH) throw badRequest('Nome de servidor muito longo.');
  }
  const description = input.description === undefined ? guild.description : input.description?.trim() || null;
  if (description && description.length > MAX_GUILD_DESCRIPTION_LENGTH) {
    throw badRequest(`A descrição pode ter no máximo ${MAX_GUILD_DESCRIPTION_LENGTH} caracteres.`);
  }
  if (input.iconColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.iconColor)) {
    throw badRequest('Cor de ícone inválida.');
  }

  const updated = db
    .update(schema.guilds)
    .set({
      name: name ?? guild.name,
      description,
      iconUrl: input.iconUrl === undefined ? guild.iconUrl : input.iconUrl,
      bannerUrl: input.bannerUrl === undefined ? guild.bannerUrl : input.bannerUrl,
      iconColor: input.iconColor ?? guild.iconColor,
    })
    .where(eq(schema.guilds.id, guildId))
    .returning()
    .get();

  const summary = toGuildSummary(updated, origin);
  recordAudit(guildId, actorId, { action: 'guild.update', targetName: summary.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'guild:update', guild: summary });
  return summary;
}

export function deleteGuild(userId: string, guildId: string): void {
  const guild = getGuildRow(guildId);
  if (guild.ownerId !== userId) throw forbidden('Apenas o dono pode excluir o servidor.');
  const members = guildMemberIds(guildId);
  deleteAssetsForGuild(guildId);
  db.delete(schema.guilds).where(eq(schema.guilds.id, guildId)).run();
  hub.emitToUsers(members, { type: 'guild:delete', guildId });
}

export function deleteAssetsForGuild(guildId: string): void {
  const byLegacyColumn = db
    .select({ id: schema.attachments.id })
    .from(schema.attachments)
    .innerJoin(schema.messages, eq(schema.messages.attachmentId, schema.attachments.id))
    .innerJoin(schema.channels, eq(schema.channels.id, schema.messages.channelId))
    .where(eq(schema.channels.guildId, guildId))
    .all();
  const byLinkTable = db
    .select({ id: schema.attachments.id })
    .from(schema.attachments)
    .innerJoin(schema.messageAttachments, eq(schema.messageAttachments.attachmentId, schema.attachments.id))
    .innerJoin(schema.messages, eq(schema.messages.id, schema.messageAttachments.messageId))
    .innerJoin(schema.channels, eq(schema.channels.id, schema.messages.channelId))
    .where(eq(schema.channels.guildId, guildId))
    .all();
  const urls = new Set<string>();
  for (const row of [...byLegacyColumn, ...byLinkTable]) {
    const attachment = db.select({ url: schema.attachments.url }).from(schema.attachments).where(eq(schema.attachments.id, row.id)).get();
    if (attachment) urls.add(attachment.url);
    db.delete(schema.attachments).where(eq(schema.attachments.id, row.id)).run();
  }
  // guild images live in the same folder
  const guild = getGuildRow(guildId);
  if (guild.iconUrl) urls.add(guild.iconUrl);
  if (guild.bannerUrl) urls.add(guild.bannerUrl);
  void deleteUploadedFiles(urls);
}

export function leaveGuild(userId: string, guildId: string): void {
  const guild = getGuildRow(guildId);
  requireMembership(guildId, userId);
  if (guild.ownerId === userId) throw forbidden('O dono não pode sair; exclua o servidor ou transfira a posse.');
  removeMember(userId, guildId, userId);
}

export function removeMember(actorId: string, guildId: string, targetUserId: string): void {
  const actor = actorContext(guildId, actorId);
  if (targetUserId !== actorId) {
    const allowed = (actor.permissions & Permission.ManageMembers) === Permission.ManageMembers;
    if (!allowed) throw forbidden('Você não pode remover membros.');
    if (!canActOn(actor, targetUserId)) throw forbidden('Você não pode remover alguém acima de você.');
  }
  if (targetUserId === actor.guild.ownerId) throw forbidden('Não é possível remover o dono do servidor.');

  if (targetUserId !== actorId) {
    const target = db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).get();
    recordAudit(guildId, actorId, {
      action: 'member.kick',
      targetId: targetUserId,
      targetName: target?.displayName ?? null,
    });
  }
  removeMemberFromGuild(guildId, targetUserId);
}

/**
 * Drops membership, roles and voice presence without any permission check.
 * Callers are responsible for authorising the removal.
 */
export function removeMemberFromGuild(guildId: string, targetUserId: string): void {
  db.delete(schema.guildMembers)
    .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, targetUserId)))
    .run();
  db.delete(schema.memberRoles)
    .where(and(eq(schema.memberRoles.guildId, guildId), eq(schema.memberRoles.userId, targetUserId)))
    .run();
  forceLeaveGuildVoice(guildId, targetUserId);
  hub.emitToUsers(guildMemberIds(guildId), { type: 'member:remove', guildId, userId: targetUserId });
  hub.emitToUsers([targetUserId], { type: 'member:remove', guildId, userId: targetUserId });
  hub.syncUserRooms(targetUserId);
}

/** Legacy single-role endpoint kept for compatibility: maps to the system roles. */
export function changeMemberRole(actorId: string, guildId: string, targetUserId: string, role: GuildRole): void {
  if (role === 'owner') throw badRequest('O cargo de dono não pode ser atribuído.');
  const roleId =
    role === 'admin' ? SYSTEM_ROLE_IDS.admin(guildId) : SYSTEM_ROLE_IDS.member(guildId);
  setMemberRoles(guildId, actorId, targetUserId, [roleId]);
}

export function assignRoles(guildId: string, actorId: string, targetUserId: string, roleIds: string[]): void {
  setMemberRoles(guildId, actorId, targetUserId, roleIds);
}

export function getMemberRoleIds(guildId: string, userId: string): string[] {
  return memberRolesOf(guildId, userId).map((role) => role.id);
}

const bannedFromJoin = () => hidden('Convite inválido ou expirado.');

export function joinGuildByInvite(user: UserRow, code: string, origin = ''): GuildWithDetails {
  const invite = requireRedeemableInvite(code);

  const existing = getMembership(invite.guildId, user.id);
  if (existing) return getGuildDetails(invite.guildId, user.id, origin);

  // a ban is reported exactly like a dead invite, so it does not confirm the guild exists
  if (isBanned(invite.guildId, user.id)) throw bannedFromJoin();

  const joinedAt = nowIso();
  // redeem and join as one unit. The "still redeemable?" read cannot hold the counter, so a
  // conditional UPDATE claims a use; a lost claim aborts before anything is written.
  db.transaction((tx) => {
    const limit = invite.maxUses === 0 ? 1 : invite.maxUses;
    const claimed = tx
      .update(schema.invites)
      .set({ uses: sql`${schema.invites.uses} + 1` })
      .where(
        and(
          eq(schema.invites.code, invite.code),
          invite.maxUses === 0 ? sql`1 = 1` : lt(schema.invites.uses, limit),
        ),
      )
      .returning({ uses: schema.invites.uses })
      .all();
    if (claimed.length === 0) throw conflict('Este convite acabou de atingir o limite de usos.');
    // a ban committed after the first check still wins: re-check under the same write lock
    if (isBanned(invite.guildId, user.id)) throw bannedFromJoin();
    tx.insert(schema.guildMembers)
      .values({ guildId: invite.guildId, userId: user.id, role: 'member', joinedAt })
      .run();
  });

  const guild = getGuildDetails(invite.guildId, user.id, origin);
  const member = guild.members.find((entry) => entry.user.id === user.id)!;

  hub.emitToUsers([user.id], { type: 'guild:create', guild });
  hub.emitToUsers(guildMemberIds(invite.guildId), { type: 'member:add', guildId: invite.guildId, member });
  hub.syncUserRooms(user.id);
  return guild;
}

export function listGuildChannels(guildId: string, userId: string): Channel[] {
  requireMembership(guildId, userId);
  return db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.kind, 'guild'), eq(schema.channels.guildId, guildId)))
    .orderBy(asc(schema.channels.position))
    .all()
    .map(toChannel);
}

export function getChannelRow(channelId: string): Channel {
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!row) throw notFound('Canal não encontrado.');
  return toChannel(row);
}

export function createChannel(
  guildId: string,
  actorId: string,
  input: { name: string; type?: 'text' | 'voice'; topic?: string | null; userLimit?: number; categoryId?: string | null },
): Channel {
  const actor = actorContext(guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode criar canais.');

  const slug = channelSlug(input.name);
  if (!slug) throw badRequest('Nome de canal inválido.');
  if (slug.length > MAX_CHANNEL_NAME_LENGTH) throw badRequest('Nome de canal muito longo.');

  if (input.categoryId) {
    const category = db.select().from(schema.channels).where(eq(schema.channels.id, input.categoryId)).get();
    if (!category || category.guildId !== guildId || category.type !== 'category') {
      throw notFound('Categoria não encontrada.');
    }
  }

  // the same name is allowed in two different categories, like Discord
  const duplicate = db
    .select({ id: schema.channels.id })
    .from(schema.channels)
    .where(and(eq(schema.channels.guildId, guildId), eq(schema.channels.name, slug), eq(schema.channels.type, input.type ?? 'text')))
    .all()
    .find((row) => {
      const current = db.select().from(schema.channels).where(eq(schema.channels.id, row.id)).get();
      return (current?.categoryId ?? null) === (input.categoryId ?? null);
    });
  if (duplicate) throw conflict('Já existe um canal com esse nome.');

  const last = db
    .select({ position: schema.channels.position })
    .from(schema.channels)
    .where(eq(schema.channels.guildId, guildId))
    .orderBy(asc(schema.channels.position))
    .all()
    .at(-1);

  const row: ChannelRow = {
    id: newId(),
    kind: 'guild',
    guildId,
    name: slug,
    topic: input.topic?.trim() || null,
    type: input.type ?? 'text',
    position: (last?.position ?? 0) + 1,
    userLimit: input.userLimit ?? 0,
    categoryId: input.categoryId ?? null,
    private: false,
    createdAt: nowIso(),
  };
  db.insert(schema.channels).values(row).run();

  const channel = toChannel(row);
  recordAudit(guildId, actorId, { action: 'channel.create', targetId: channel.id, targetName: channel.name });
  hub.emitToUsers(guildMemberIds(guildId), { type: 'channel:create', channel });
  hub.syncUserRoomsForGuild(guildId);
  return channel;
}

function guildChannelForActor(channelId: string, actorId: string): ChannelRow {
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!row || row.kind !== 'guild' || !row.guildId) throw notFound('Canal não encontrado.');
  const actor = actorContext(row.guildId, actorId);
  requirePermission(actor, Permission.ManageChannels, 'Você não pode gerenciar canais.');
  return row;
}

export function updateChannel(
  userId: string,
  channelId: string,
  input: {
    name?: string;
    topic?: string | null;
    userLimit?: number;
    overrides?: { roleId: string; allow: number; deny: number }[];
  },
): Channel {
  const row = guildChannelForActor(channelId, userId);

  let name = row.name;
  if (input.name !== undefined) {
    const slug = channelSlug(input.name);
    if (!slug) throw badRequest('Nome de canal inválido.');
    name = slug;
  }
  const topic = input.topic === undefined ? row.topic : input.topic?.trim() || null;
  if (input.userLimit !== undefined) {
    if (!Number.isInteger(input.userLimit) || input.userLimit < 0 || input.userLimit > 99) {
      throw badRequest('O limite de usuários deve ficar entre 0 e 99.');
    }
    if (row.type !== 'voice' && input.userLimit > 0) throw badRequest('Só canais de voz têm limite de usuários.');
  }
  const userLimit = input.userLimit === undefined ? row.userLimit : input.userLimit;

  if (input.overrides) {
    if (row.type !== 'voice' || !row.guildId) throw badRequest('Permissões por canal só se aplicam a canais de voz.');
    // an override writes into the permission resolver, so it obeys the same rules as a role edit:
    // roles must belong to this guild, and nobody may grant what they do not hold
    const guildId = row.guildId;
    const actor = actorContext(guildId, userId);
    const seen = new Set<string>();
    for (const override of input.overrides) {
      if (seen.has(override.roleId)) throw badRequest('Cargo repetido nas permissões do canal.');
      seen.add(override.roleId);
      // `@everyone` is a virtual id in the resolver, not a role row, so it is accepted as-is
      if (override.roleId !== EVERYONE_OVERRIDE_ID) getRoleOrThrow(guildId, override.roleId);
      if (!actor.isOwner && (override.allow & ~actor.permissions) !== 0) {
        throw forbidden('Você não pode conceder permissões que você não possui.');
      }
    }
    db.delete(schema.channelOverrides).where(eq(schema.channelOverrides.channelId, channelId)).run();
    for (const override of input.overrides) {
      db.insert(schema.channelOverrides)
        .values({ channelId, roleId: override.roleId, allow: override.allow, deny: override.deny })
        .run();
    }
  }

  const updated = db
    .update(schema.channels)
    .set({ name, topic, userLimit })
    .where(eq(schema.channels.id, channelId))
    .returning()
    .get();
  const channel = toChannel(updated);
  recordAudit(row.guildId!, userId, { action: 'channel.update', targetId: channel.id, targetName: channel.name });
  hub.emitToUsers(guildMemberIds(row.guildId!), { type: 'channel:update', channel });
  return channel;
}

export function deleteChannel(userId: string, channelId: string): void {
  const row = guildChannelForActor(channelId, userId);
  db.delete(schema.channels).where(eq(schema.channels.id, channelId)).run();
  recordAudit(row.guildId!, userId, { action: 'channel.delete', targetId: channelId, targetName: row.name });
  hub.emitToUsers(guildMemberIds(row.guildId!), { type: 'channel:delete', channelId, guildId: row.guildId! });
}

export function getGuildChannel(channelId: string, userId: string): Channel {
  const row = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!row) throw notFound('Canal não encontrado.');
  if (!channelAudience(channelId).includes(userId)) throw forbidden('Você não tem acesso a este canal.');
  if (row.kind === 'guild' && row.guildId) {
    // reading a channel only requires being a member with ViewChannel
    const actor = actorContext(row.guildId, userId);
    requirePermission(actor, Permission.ViewChannel, 'Você não pode ver este canal.');
  }
  return toChannel(row);
}

export type { GuildRole, GuildRoleEntity };
