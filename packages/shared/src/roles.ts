import type { GuildRole } from './entities';

export interface GuildRoleEntity {
  id: string;
  guildId: string;
  name: string;
  color: string;
  /** Bit mask of `Permission` flags. */
  permissions: number;
  /** Higher values win: a role can only manage roles below its own position. */
  position: number;
  /** Codename role everyone receives on join; cannot be deleted or reordered away. */
  isEveryone: boolean;
  /** System roles are seeded by the server and protected from deletion. */
  isSystem: boolean;
  createdAt: string;
}

export interface RoleSummary extends GuildRoleEntity {
  memberCount: number;
}

export type GuildConfiguration = {
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  iconColor: string;
};

/** Role + the permissions the viewer actually holds after OR-ing all roles. */
export interface MemberPermissions {
  permissions: number;
  isOwner: boolean;
  /** Highest role position the member holds (used to enforce hierarchy). */
  position: number;
}

export interface CreateRoleInput {
  name: string;
  color?: string;
  permissions?: number;
}

export interface UpdateRoleInput {
  name?: string;
  color?: string;
  permissions?: number;
  position?: number;
}

export type { GuildRole };
