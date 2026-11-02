import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    bio: text('bio'),
    /** Bumped on logout/password change: older session tokens stop verifying. */
    tokenVersion: integer('token_version').notNull().default(0),
    accentColor: text('accent_color').notNull(),
    status: text('status', { enum: ['online', 'idle', 'dnd', 'offline'] })
      .notNull()
      .default('online'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('users_username_unique').on(table.username),
    uniqueIndex('users_email_unique').on(table.email),
  ],
);

export const guilds = sqliteTable('guilds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  iconUrl: text('icon_url'),
  bannerUrl: text('banner_url'),
  iconColor: text('icon_color').notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
});

export const guildMembers = sqliteTable(
  'guild_members',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#99aab5'),
    permissions: integer('permissions').notNull().default(0),
    position: integer('position').notNull().default(0),
    isEveryone: integer('is_everyone', { mode: 'boolean' }).notNull().default(false),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('roles_guild_idx').on(table.guildId)],
);

export type RoleRow = typeof roles.$inferSelect;

export const memberRoles = sqliteTable(
  'member_roles',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId, table.roleId] })],
);

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['guild', 'dm'] }).notNull(),
  guildId: text('guild_id').references(() => guilds.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  topic: text('topic'),
  type: text('type', { enum: ['text', 'voice', 'category'] })
    .notNull()
    .default('text'),
  position: integer('position').notNull().default(0),
  /** Voice channels: 0 = unlimited seats. */
  userLimit: integer('user_limit').notNull().default(0),
  /** `category` rows are headings; they hold channels but no messages. */
  categoryId: text('category_id'),
  /** Mirrors the @everyone deny on ViewChannel, so the list can label the channel. */
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const channelMembers = sqliteTable(
  'channel_members',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.userId] })],
);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  uploaderId: text('uploader_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  url: text('url').notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: text('created_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  authorId: text('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  /** Legacy single-attachment column; new messages use `message_attachments`. */
  attachmentId: text('attachment_id').references(() => attachments.id, { onDelete: 'set null' }),
  replyToId: text('reply_to_id'),
  editedAt: text('edited_at'),
  createdAt: text('created_at').notNull(),
});

export const messageAttachments = sqliteTable(
  'message_attachments',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.attachmentId] })],
);

export const reactions = sqliteTable(
  'reactions',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId, table.emoji] })],
);

export const channelOverrides = sqliteTable(
  'channel_overrides',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    /** `@everyone` is stored with the special id `@everyone`. */
    roleId: text('role_id').notNull(),
    allow: integer('allow').notNull().default(0),
    deny: integer('deny').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.roleId] })],
);

export const voiceStates = sqliteTable(
  'voice_states',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    selfMute: integer('self_mute', { mode: 'boolean' }).notNull().default(false),
    selfDeaf: integer('self_deaf', { mode: 'boolean' }).notNull().default(false),
    serverMute: integer('server_mute', { mode: 'boolean' }).notNull().default(false),
    serverDeaf: integer('server_deaf', { mode: 'boolean' }).notNull().default(false),
    joinedAt: text('joined_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

/**
 * Friend requests and blocks. One row per pair: `requesterId` is whoever sent
 * the request (or did the blocking), so the direction always survives.
 */
export const relationships = sqliteTable(
  'relationships',
  {
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** pending | accepted | blocked (blocker is always the requester). */
    kind: text('kind', { enum: ['pending', 'accepted', 'blocked'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.requesterId, table.addresseeId] })],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    targetId: text('target_id'),
    targetName: text('target_name'),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('audit_logs_guild_idx').on(table.guildId, table.createdAt)],
);

export const guildBans = sqliteTable(  'guild_bans',
  {
    guildId: text('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moderatorId: text('moderator_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    /** ISO expiry; null means permanent. */
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const invites = sqliteTable('invites', {
  code: text('code').primaryKey(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  uses: integer('uses').notNull().default(0),
  /** 0 means unlimited. */
  maxUses: integer('max_uses').notNull().default(0),
  /** ISO expiry; null means the invite never expires. */
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type GuildRow = typeof guilds.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type GuildMemberRow = typeof guildMembers.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type GuildBanRow = typeof guildBans.$inferSelect;
export type RelationshipRow = typeof relationships.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
