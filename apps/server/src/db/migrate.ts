import { sqlite } from './client';
import { createDefaultRoles } from '../services/roles';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    accent_color TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'online',
    bio TEXT,
    banner_url TEXT,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,
  `CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon_url TEXT,
    icon_color TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS guild_members (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#99aab5',
    permissions INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    is_everyone INTEGER NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS roles_guild_idx ON roles (guild_id)`,
  `CREATE TABLE IF NOT EXISTS member_roles (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    topic TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS channels_guild_idx ON channels (guild_id)`,
  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
    edited_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages (channel_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS message_attachments (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, attachment_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS channel_overrides (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL,
    allow INTEGER NOT NULL DEFAULT 0,
    deny INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS voice_states (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    self_mute INTEGER NOT NULL DEFAULT 0,
    self_deaf INTEGER NOT NULL DEFAULT 0,
    server_mute INTEGER NOT NULL DEFAULT 0,
    server_deaf INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS voice_states_channel_idx ON voice_states (channel_id)`,
  `CREATE TABLE IF NOT EXISTS guild_bans (
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    moderator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS relationships (
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('pending', 'accepted', 'blocked')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (requester_id, addressee_id)
  )`,
  `CREATE INDEX IF NOT EXISTS relationships_addressee_idx ON relationships (addressee_id)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target_id TEXT,
    target_name TEXT,
    reason TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS audit_logs_guild_idx ON audit_logs (guild_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uses INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_at TEXT NOT NULL
  )`,
];

/** Adds a column to an existing table only when it is missing (SQLite has no IF NOT EXISTS). */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = sqlite.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Guilds created before roles existed have no `@everyone` role. Create the
 * default set and move legacy `admin` members into the Administrador role so
 * they keep the abilities they had.
 */
function backfillRoles(): void {
  const rows = sqlite
    .query(
      `SELECT g.id AS id FROM guilds g
       WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.guild_id = g.id AND r.is_everyone = 1)`,
    )
    .all() as { id: string }[];

  for (const row of rows) {
    const guild = sqlite.query('SELECT owner_id, created_at FROM guilds WHERE id = ?').get(row.id) as
      | { owner_id: string; created_at: string }
      | null;
    if (!guild) continue;
    createDefaultRoles({
      id: row.id,
      name: '',
      description: null,
      iconUrl: null,
      bannerUrl: null,
      iconColor: '#a1a1aa',
      ownerId: guild.owner_id,
      createdAt: guild.created_at,
    });
    sqlite
      .query(
        `INSERT OR IGNORE INTO member_roles (guild_id, user_id, role_id)
         SELECT guild_id, user_id, ? FROM guild_members WHERE guild_id = ? AND role = 'admin'`,
      )
      .run(`admin-${row.id}`, row.id);
  }
}

export function migrate(): void {
  sqlite.transaction(() => {
    for (const statement of DDL) sqlite.exec(statement);
    ensureColumn('guilds', 'description', 'TEXT');
    ensureColumn('guilds', 'banner_url', 'TEXT');
    ensureColumn('messages', 'reply_to_id', 'TEXT');
    ensureColumn('channels', 'user_limit', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('invites', 'max_uses', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('invites', 'expires_at', 'TEXT');
    ensureColumn('users', 'banner_url', 'TEXT');
    ensureColumn('users', 'bio', 'TEXT');
    ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn('channels', 'category_id', 'TEXT');
    ensureColumn('channels', 'private', 'INTEGER NOT NULL DEFAULT 0');
    sqlite.exec('CREATE INDEX IF NOT EXISTS channels_category_idx ON channels (category_id)');
    // messages sent before multi-attachment support keep their single file visible
    sqlite.exec(
      `INSERT OR IGNORE INTO message_attachments (message_id, attachment_id, position)
       SELECT id, attachment_id, 0 FROM messages WHERE attachment_id IS NOT NULL`,
    );
  })();
  backfillRoles();
}
