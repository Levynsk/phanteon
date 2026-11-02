import { ALL_PERMISSIONS, Permission, type GuildWithDetails } from '@phanteon/shared';

/** Helpers that read the guild's effective permissions for the signed-in user. */

function has(guild: GuildWithDetails | undefined, ...flags: number[]): boolean {
  if (!guild) return false;
  const mask = guild.isOwner ? ALL_PERMISSIONS : guild.myPermissions;
  return flags.every((flag) => (mask & flag) === flag);
}

export const canManageGuild = (guild: GuildWithDetails | undefined) => has(guild, Permission.ManageGuild);
export const canManageRoles = (guild: GuildWithDetails | undefined) => has(guild, Permission.ManageRoles);
export const canManageMembers = (guild: GuildWithDetails | undefined) => has(guild, Permission.ManageMembers);
export const canManageMessages = (guild: GuildWithDetails | undefined) => has(guild, Permission.ManageMessages);
export const canSendMessages = (guild: GuildWithDetails | undefined) => has(guild, Permission.SendMessages);

/** Highest role position the current user holds in this guild. */
export function myPosition(guild: GuildWithDetails, userId: string): number {
  if (guild.isOwner) return Number.MAX_SAFE_INTEGER;
  return guild.members.find((member) => member.user.id === userId)?.position ?? 0;
}
