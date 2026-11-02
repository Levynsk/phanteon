import type {
  Attachment,
  GuildMember,
  GuildSummary,
  GuildWithDetails,
  Message,
  MessageReference,
  PublicUser,
  Reaction,
  GuildRoleEntity,
} from '@phanteon/shared';
import type {
  AttachmentRow,
  ChannelRow,
  GuildMemberRow,
  GuildRow,
  MessageRow,
  UserRow,
} from '../db/schema';
import type { Channel } from '@phanteon/shared';
import { config } from '../config/env';
import { signedFilePath } from '../services/file-links';

/**
 * Request body for a user other people can see. It deliberately has no e-mail: the
 * address is only returned to the account owner (login, bootstrap, own profile edit).
 */
export function toPublicUser(row: UserRow, origin = ''): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: absoluteAssetUrl(row.avatarUrl, origin),
    bannerUrl: absoluteAssetUrl(row.bannerUrl, origin),
    bio: row.bio,
    accentColor: row.accentColor,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/** The viewer's own account, e-mail included so the settings screen can show it. */
export function toSelfUser(row: UserRow, origin = ''): PublicUser {
  return { ...toPublicUser(row, origin), email: row.email };
}

/** Turn a stored `/files/...` path into an absolute URL for the requesting client. */
export function absoluteAssetUrl(url: string | null, origin: string): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // every `/files/...` link the API hands out is signed and short-lived
  return `${origin}${signedFilePath(config.fileLinkSecret, url)}`;
}

export function toGuildSummary(row: GuildRow, origin = ''): GuildSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconUrl: absoluteAssetUrl(row.iconUrl, origin),
    bannerUrl: absoluteAssetUrl(row.bannerUrl, origin),
    iconColor: row.iconColor,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
  };
}

export function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    kind: row.kind,
    guildId: row.guildId,
    name: row.name,
    topic: row.topic,
    type: row.type,
    position: row.position,
    userLimit: row.userLimit,
    categoryId: row.categoryId ?? null,
    private: row.private,
    createdAt: row.createdAt,
  };
}

export function toGuildMember(
  row: GuildMemberRow,
  user: UserRow,
  online: boolean,
  roleIds: string[] = [],
  position = 0,
): GuildMember {
  return {
    guildId: row.guildId,
    role: row.role,
    joinedAt: row.joinedAt,
    user: toPublicUser(user),
    online,
    roleIds,
    position,
  };
}

export function toGuildWithDetails(
  guild: GuildRow,
  channels: ChannelRow[],
  members: GuildMember[],
  roles: GuildRoleEntity[],
  viewer: { permissions: number; isOwner: boolean },
  origin = '',
): GuildWithDetails {
  return {
    ...toGuildSummary(guild, origin),
    channels: channels.map(toChannel),
    members,
    roles,
    myPermissions: viewer.permissions,
    isOwner: viewer.isOwner,
  };
}

export function toAttachment(row: AttachmentRow, origin: string): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    url: absoluteAssetUrl(row.url, origin)!,
    width: row.width,
    height: row.height,
  };
}

export function toMessage(
  row: MessageRow,
  author: UserRow,
  attachmentRows: AttachmentRow[],
  replyTo: MessageReference | null,
  reactions: Reaction[],
  origin: string,
): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    author: toPublicUser(author),
    content: row.content,
    attachments: attachmentRows.map((attachment) => toAttachment(attachment, origin)),
    replyTo,
    reactions,
    editedAt: row.editedAt,
    createdAt: row.createdAt,
  };
}
