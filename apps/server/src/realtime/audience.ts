import { and, eq, inArray } from 'drizzle-orm';
import { Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { resolveChannelPermissions } from '../services/roles';

export function guildMemberIds(guildId: string): string[] {
  return db
    .select({ userId: schema.guildMembers.userId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.guildId, guildId))
    .all()
    .map((row) => row.userId);
}

export function channelAudience(channelId: string): string[] {
  const channel = db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.id, channelId))
    .get();
  if (!channel) return [];
  if (channel.kind === 'guild' && channel.guildId) return guildMemberIds(channel.guildId);
  return db
    .select({ userId: schema.channelMembers.userId })
    .from(schema.channelMembers)
    .where(eq(schema.channelMembers.channelId, channelId))
    .all()
    .map((row) => row.userId);
}

export function dmAudience(channelId: string): string[] {
  return channelAudience(channelId);
}

export function sharedRuntimeUserIds(userId: string): string[] {
  const guildIds = db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);

  const ids = new Set<string>([userId]);
  if (guildIds.length > 0) {
    const peers = db
      .select({ userId: schema.guildMembers.userId })
      .from(schema.guildMembers)
      .where(inArray(schema.guildMembers.guildId, guildIds))
      .all();
    for (const peer of peers) ids.add(peer.userId);
  }

  const dmMembers = db
    .select({ channelId: schema.channelMembers.channelId })
    .from(schema.channelMembers)
    .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
    .where(and(eq(schema.channelMembers.userId, userId), eq(schema.channels.kind, 'dm')))
    .all();

  if (dmMembers.length > 0) {
    const peers = db
      .select({ userId: schema.channelMembers.userId })
      .from(schema.channelMembers)
      .where(
        inArray(
          schema.channelMembers.channelId,
          dmMembers.map((row) => row.channelId),
        ),
      )
      .all();
    for (const peer of peers) ids.add(peer.userId);
  }

  return [...ids];
}

export function visibleGuildIds(userId: string): string[] {
  return db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);
}

export function visibleChannelIds(userId: string): string[] {
  const guildIds = visibleGuildIds(userId);
  const guildChannels = guildIds.length
    ? db
        .select({ id: schema.channels.id })
        .from(schema.channels)
        .where(and(eq(schema.channels.kind, 'guild'), inArray(schema.channels.guildId, guildIds)))
        .all()
        .map((row) => row.id)
    : [];
  const dmChannels = db
    .select({ id: schema.channelMembers.channelId })
    .from(schema.channelMembers)
    .where(eq(schema.channelMembers.userId, userId))
    .all()
    .map((row) => row.id);
  // private channels stay out of the list unless an override grants ViewChannel
  return [...guildChannels.filter((channelId) => isChannelVisibleTo(channelId, userId)), ...dmChannels];
}

/** Whether the user currently sees a channel: membership plus the channel-level overrides. */
/**
 * Members of a guild channel who may take the channel's attachments. Voice
 * channels grant Join to every member by default, so files now require the
 * text-channel permission instead: viewing them is not joining the call.
 */
const FILE_PERMISSION = Permission.ViewChannel | Permission.SendMessages;

export function fileAudience(channelId: string): string[] {
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) return [];
  if (channel.kind === 'dm' || !channel.guildId) return channelAudience(channelId);
  // a voice channel is not a place for files: joining a call must not unlock its uploads
  if (channel.type !== 'text') return [];
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, channel.guildId)).get();
  if (!guild) return [];
  return guildMemberIds(channel.guildId).filter((userId) => (resolveChannelPermissions(guild, channelId, userId) & FILE_PERMISSION) === FILE_PERMISSION);
}

export function canDownloadChannelFiles(channelId: string, userId: string): boolean {
  return fileAudience(channelId).includes(userId);
}

export function isChannelVisibleTo(channelId: string, userId: string): boolean {
  if (!channelAudience(channelId).includes(userId)) return false;
  const channel = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel || channel.kind !== 'guild' || !channel.guildId) return true;
  const guild = db.select().from(schema.guilds).where(eq(schema.guilds.id, channel.guildId)).get();
  if (!guild) return false;
  return (resolveChannelPermissions(guild, channelId, userId) & Permission.ViewChannel) !== 0;
}
