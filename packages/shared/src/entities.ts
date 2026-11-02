export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';
/** Coarse legacy role kept for ordering (@everyone < admin < owner). */
export type GuildRole = 'owner' | 'admin' | 'member';
export type ChannelType = 'text' | 'voice' | 'category';
export type ChannelKind = 'guild' | 'dm';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  /** Only sent to the user themselves; other payloads omit it. */
  email?: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  accentColor: string;
  status: UserStatus;
  createdAt: string;
}

export interface GuildSummary {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  iconColor: string;
  ownerId: string;
  createdAt: string;
}

export interface GuildMember {
  guildId: string;
  role: GuildRole;
  joinedAt: string;
  user: PublicUser;
  /** true when the user has at least one live socket */
  online: boolean;
  /** Role ids assigned to the member, ordered from highest to lowest position. */
  roleIds: string[];
  /** Highest position among the member's roles (0 for members with only @everyone). */
  position: number;
}

export interface GuildWithDetails extends GuildSummary {
  channels: Channel[];
  members: GuildMember[];
  roles: import('./roles').GuildRoleEntity[];
  /** Effective permission mask of the requesting user. */
  myPermissions: number;
  isOwner: boolean;
}

export interface Channel {
  id: string;
  kind: ChannelKind;
  guildId: string | null;
  name: string;
  topic: string | null;
  type: ChannelType;
  position: number;
  /** Voice channels only: 0 means unlimited. */
  userLimit: number;
  /** Category that holds this channel; null means it sits at the top level. */
  categoryId: string | null;
  /** True when the channel hides from @everyone and only listed roles can see it. */
  private: boolean;
  createdAt: string;
}

export interface DmChannel extends Channel {
  kind: 'dm';
  recipients: PublicUser[];
  lastMessageAt: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  /** whether the requesting user reacted with it */
  me: boolean;
}

/** Snapshot of the quoted message, kept small so replies stay cheap to hydrate. */
export interface MessageReference {
  id: string;
  author: PublicUser;
  content: string;
  hasAttachments: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  author: PublicUser;
  content: string;
  attachments: Attachment[];
  /** Message this one quotes, when it was sent as a reply. */
  replyTo: MessageReference | null;
  reactions: Reaction[];
  editedAt: string | null;
  createdAt: string;
}

/** Someone currently connected to a voice channel. */
export interface VoiceState {
  channelId: string;
  guildId: string;
  user: PublicUser;
  /** The user muted themselves. */
  selfMute: boolean;
  /** The user deafened themselves (also implies self mute in practice). */
  selfDeaf: boolean;
  /** A moderator muted them on the server. */
  serverMute: boolean;
  /** A moderator deafened them on the server. */
  serverDeaf: boolean;
  joinedAt: string;
}

/** Ban entry. `expiresAt` is null for a permanent ban. */
export interface GuildBan {
  guildId: string;
  user: PublicUser;
  moderator: PublicUser | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/** Single administrative action recorded for moderators. */
export interface AuditLogEntry {
  id: string;
  guildId: string;
  actor: { id: string; displayName: string; avatarUrl: string | null };
  action: string;
  targetId: string | null;
  targetName: string | null;
  reason: string | null;
  createdAt: string;
}

/** Invite entry. `maxUses` 0 means unlimited; `expiresAt` null means it never expires. */
export interface GuildInvite {
  code: string;
  guildId: string;
  inviter: { id: string; displayName: string; avatarUrl: string | null } | null;
  uses: number;
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
  /** Whether the invite can still be redeemed right now. */
  active: boolean;
}

export type RelationshipKind = 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'blockedBy';

/** One side of a friendship row, as seen by the requesting user. */
export interface Relationship {
  user: PublicUser;
  kind: RelationshipKind;
  createdAt: string;
}

export interface FriendsOverview {
  friends: Relationship[];
  incoming: Relationship[];
  outgoing: Relationship[];
  blocked: Relationship[];
}

export interface AuthSession {
  token: string;
  user: PublicUser;
}
