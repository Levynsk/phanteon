import { and, eq } from 'drizzle-orm';
import { Permission, type VoiceState } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { nowIso } from '../db/ids';
import { toPublicUser } from '../db/mappers';
import type { UserRow } from '../db/schema';
import { badRequest, forbidden, notFound } from '../http/errors';
import { guildMemberIds } from '../realtime/audience';
import { hub } from '../realtime/hub';
import { actorContext, canActOn, resolveChannelPermissions } from './roles';

function getVoiceChannel(channelId: string) {
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) throw notFound('Canal não encontrado.');
  if (channel.type !== 'voice' || !channel.guildId) throw badRequest('Este canal não é de voz.');
  return { ...channel, guildId: channel.guildId };
}

function toVoiceState(row: typeof schema.voiceStates.$inferSelect, user: UserRow): VoiceState {
  return {
    channelId: row.channelId,
    guildId: row.guildId,
    user: toPublicUser(user),
    selfMute: row.selfMute,
    selfDeaf: row.selfDeaf,
    serverMute: row.serverMute,
    serverDeaf: row.serverDeaf,
    joinedAt: row.joinedAt,
  };
}

function voiceStateOf(guildId: string, userId: string): VoiceState | null {
  const row = db
    .select()
    .from(schema.voiceStates)
    .where(and(eq(schema.voiceStates.guildId, guildId), eq(schema.voiceStates.userId, userId)))
    .get();
  if (!row) return null;
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  return user ? toVoiceState(row, user) : null;
}

function statesInGuilds(guildIds: string[]): VoiceState[] {
  if (guildIds.length === 0) return [];
  const rows = db.select().from(schema.voiceStates).all().filter((row) => guildIds.includes(row.guildId));
  const users = new Map(
    db
      .select()
      .from(schema.users)
      .all()
      .map((user) => [user.id, user] as const),
  );
  const states: VoiceState[] = [];
  for (const row of rows) {
    const user = users.get(row.userId);
    if (user) states.push(toVoiceState(row, user));
  }
  return states;
}

/**
 * Call membership of a guild, with the Speak flag resolved. Voice channel
 * permission overrides are not re-broadcast when edited, so the audience recap
 * uses this to tell clients who can actually hear each other.
 */
export function currentCallAudience(guildId: string): { channelId: string; userId: string }[] {
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, guildId)).get();
  if (!guild) return [];
  return statesInGuilds([guildId]).flatMap((state) =>
    (resolveChannelPermissions(guild, state.channelId, state.user.id) & Permission.Speak) === Permission.Speak
      ? [{ channelId: state.channelId, userId: state.user.id }]
      : [],
  );
}

/** Everything a newly connected client needs to render the voice sidebar. */
export function listVoiceStatesForUser(userId: string): VoiceState[] {
  const guildIds = db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);
  return statesInGuilds(guildIds);
}

export function listGuildVoiceStates(guildId: string, viewerId: string): VoiceState[] {
  actorContext(guildId, viewerId);
  return statesInGuilds([guildId]);
}

function broadcast(state: VoiceState): void {
  hub.emitToUsers(guildMemberIds(state.guildId), { type: 'voice:state', state });
}

function broadcastLeave(guildId: string, channelId: string, userId: string): void {
  hub.emitToUsers(guildMemberIds(guildId), { type: 'voice:leave', guildId, channelId, userId });
}

function assertConnectPermission(channelId: string, userId: string) {
  const channel = getVoiceChannel(channelId);
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, channel.guildId)).get();
  if (!guild) throw notFound('Servidor não encontrado.');
  const permissions = resolveChannelPermissions(guild, channel.id, userId);
  if ((permissions & Permission.Connect) !== Permission.Connect) {
    throw forbidden('Você não tem permissão para entrar em canais de voz.');
  }
  return { channel, permissions };
}

export function joinVoice(user: UserRow, channelId: string): VoiceState {
  const { channel, permissions } = assertConnectPermission(channelId, user.id);

  // hopping an existing call skips neither Connect nor Speak checks
  const existingStates = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, user.id)).all();
  const existing = existingStates.find((state) => state.guildId === channel.guildId);
  const canSpeak = (permissions & Permission.Speak) === Permission.Speak;

  if (channel.userLimit > 0 && existing?.channelId !== channel.id) {
    const seated = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.channelId, channel.id)).all().length;
    // MoveMembers bypasses the seating limit, like a moderator moving people
    if (seated >= channel.userLimit && (permissions & Permission.MoveMembers) !== Permission.MoveMembers) {
      throw badRequest(`Este canal está cheio (limite de ${channel.userLimit}).`);
    }
  }
  db.delete(schema.voiceStates).where(eq(schema.voiceStates.userId, user.id)).run();
  for (const previous of existingStates) {
    if (previous.guildId === channel.guildId && previous.channelId === channel.id) continue;
    broadcastLeave(previous.guildId, previous.channelId, user.id);
  }

  // a deafened or muted user can still be there; only Speak gates transmission
  // hopping channels must preserve both self flags (and moderator flags) instead of
  // letting the user escape a server mute/deafen by changing voice channels
  const wasDeaf = existing?.selfDeaf ?? false;
  const wasMuted = existing?.selfMute ?? false;
  const serverMute = existing?.serverMute ?? false;
  const serverDeaf = existing?.serverDeaf ?? false;
  const row = {
    guildId: channel.guildId,
    userId: user.id,
    channelId: channel.id,
    // moderator flags win over the user's own choice
    selfMute: !canSpeak || wasMuted || wasDeaf || serverMute || serverDeaf,
    selfDeaf: !canSpeak || wasDeaf || serverDeaf,
    serverMute,
    serverDeaf,
    joinedAt: nowIso(),
  };
  db.insert(schema.voiceStates).values(row).run();
  const state = toVoiceState(row, user);
  broadcast(state);
  return state;
}

export function leaveVoice(user: UserRow, guildId: string): void {
  const row = voiceStateOf(guildId, user.id);
  if (!row) return;
  db.delete(schema.voiceStates)
    .where(and(eq(schema.voiceStates.guildId, guildId), eq(schema.voiceStates.userId, user.id)))
    .run();
  broadcastLeave(guildId, row.channelId, user.id);
}

/** Drops the user from voice when their socket set goes empty. */
export function leaveVoiceOnDisconnect(userId: string): void {
  const rows = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, userId)).all();
  for (const row of rows) {
    db.delete(schema.voiceStates)
      .where(and(eq(schema.voiceStates.guildId, row.guildId), eq(schema.voiceStates.userId, userId)))
      .run();
    broadcastLeave(row.guildId, row.channelId, userId);
  }
}

export function updateSelfVoice(user: UserRow, input: { selfMute?: boolean; selfDeaf?: boolean }): VoiceState {
  const rows = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, user.id)).all();
  const row = rows[0];
  if (!row) throw badRequest('Você não está em um canal de voz.');
  // channel override can remove Speak, which keeps the mic muted
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, row.guildId)).get();
  const canSpeak =
    !!guild && (resolveChannelPermissions(guild, row.channelId, user.id) & Permission.Speak) === Permission.Speak;
  // server mute and deafen win over self unmute / undeafen
  // a deafened user does not hear others, so the mic stays muted too
  const selfDeaf = row.serverDeaf ? true : (input.selfDeaf ?? row.selfDeaf);
  const selfMute = row.serverMute || selfDeaf || !canSpeak ? true : (input.selfMute ?? row.selfMute);
  db.update(schema.voiceStates)
    .set({ selfMute, selfDeaf })
    .where(and(eq(schema.voiceStates.guildId, row.guildId), eq(schema.voiceStates.userId, user.id)))
    .run();
  const state = voiceStateOf(row.guildId, user.id)!;
  broadcast(state);
  return state;
}

/**
 * Moderator action: mute, deafen or disconnect somebody else. Enforces the same
 * hierarchy as kicks — you cannot act on someone ranked at or above you.
 */
export function moderateVoice(
  actorUser: UserRow,
  guildId: string,
  targetUserId: string,
  action: 'serverMute' | 'serverDeaf' | 'disconnect',
): void {
  const actor = actorContext(guildId, actorUser.id);
  // deafening targets a sound permission; muting already covers both, like Discord
  const hasMute = (actor.permissions & Permission.MuteMembers) === Permission.MuteMembers;
  const hasMove = (actor.permissions & Permission.MoveMembers) === Permission.MoveMembers;
  const allowed = action === 'disconnect' ? hasMove : hasMute || (action === 'serverDeaf' && hasMove);
  if (!allowed) {
    throw forbidden('Você não tem permissão para moderar a voz.');
  }
  if (!canActOn(actor, targetUserId)) throw forbidden('Você não pode agir sobre alguém acima de você.');

  const row = voiceStateOf(guildId, targetUserId);
  if (!row) throw badRequest('Esse membro não está em um canal de voz.');

  if (action === 'disconnect') {
    db.delete(schema.voiceStates)
      .where(and(eq(schema.voiceStates.guildId, guildId), eq(schema.voiceStates.userId, targetUserId)))
      .run();
    broadcastLeave(guildId, row.channelId, targetUserId);
    return;
  }

  const value = !(action === 'serverMute' ? row.serverMute : row.serverDeaf);
  db.update(schema.voiceStates)
    .set(
      action === 'serverMute'
        ? { serverMute: value, selfMute: value ? true : row.selfMute }
        : { serverDeaf: value, selfDeaf: value ? true : row.selfDeaf, selfMute: value ? true : row.selfMute },
    )
    .where(and(eq(schema.voiceStates.guildId, guildId), eq(schema.voiceStates.userId, targetUserId)))
    .run();
  broadcast(voiceStateOf(guildId, targetUserId)!);
}

/** Broadcasts the speaking flag so the UI can draw the green ring. */
export function broadcastSpeaking(userId: string, speaking: boolean): void {
  const rows = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, userId)).all();
  const row = rows[0];
  if (!row) return;
  hub.emitToUsers(guildMemberIds(row.guildId), {
    type: 'voice:speaking',
    guildId: row.guildId,
    channelId: row.channelId,
    userId,
    speaking,
  });
}

/** Voice channel the user is seated in, used to authorise signalling. */
export function currentVoiceChannel(userId: string): string | null {
  return db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, userId)).get()?.channelId ?? null;
}

/** Drops the user from every call they are in (leaving the guilds, signing out, deleting the account). */
export function leaveAllVoice(userId: string): void {
  const rows = db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, userId)).all();
  for (const row of rows) forceLeaveGuildVoice(row.guildId, userId);
}

/** Called when a member leaves/is removed so they do not linger in a call. */
export function forceLeaveGuildVoice(guildId: string, userId: string): void {
  const row = voiceStateOf(guildId, userId);
  if (!row) return;
  db.delete(schema.voiceStates)
    .where(and(eq(schema.voiceStates.guildId, guildId), eq(schema.voiceStates.userId, userId)))
    .run();
  broadcastLeave(guildId, row.channelId, userId);
}
