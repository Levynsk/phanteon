import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DmChannel } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, nowIso } from '../db/ids';
import { toChannel, toPublicUser } from '../db/mappers';
import type { ChannelRow, UserRow } from '../db/schema';
import { badRequest, notFound } from '../http/errors';
import { hub } from '../realtime/hub';
import { assertDmAllowed, blocksBetween } from './relationships';

export function toDmChannel(row: ChannelRow, recipients: UserRow[], lastMessageAt: string | null): DmChannel {
  return {
    ...toChannel(row),
    kind: 'dm',
    guildId: null,
    recipients: recipients.map((user) => toPublicUser(user)),
    lastMessageAt,
  };
}

function recipientsOf(channelId: string): UserRow[] {
  return db
    .select({ user: schema.users })
    .from(schema.channelMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.channelMembers.userId))
    .where(eq(schema.channelMembers.channelId, channelId))
    .orderBy(asc(schema.users.createdAt))
    .all()
    .map((row) => row.user);
}

function lastMessageAt(channelId: string): string | null {
  const row = db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(eq(schema.messages.channelId, channelId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1)
    .get();
  return row?.createdAt ?? null;
}

/** Existing DM between two users, if any (used to avoid duplicates via another route). */
/**
 * The conversation between two users, only when it still involves both of them:
 * the id is also used to turn a pair of users into a channel, so an unknown or
 * blocked pair must not answer anything.
 */
export function findVisibleDirectChannel(viewerId: string, otherId: string): ChannelRow | null {
  if (blocksBetween(viewerId, otherId)) return null;
  return findDirectChannel(viewerId, otherId);
}

export function findDirectChannel(a: string, b: string): ChannelRow | null {
  return (
    db
      .select({ channel: schema.channels })
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.kind, 'dm'),
          sql`EXISTS (SELECT 1 FROM channel_members ci WHERE ci.channel_id = ${schema.channels.id} AND ci.user_id = ${a})`,
          sql`EXISTS (SELECT 1 FROM channel_members ci WHERE ci.channel_id = ${schema.channels.id} AND ci.user_id = ${b})`,
          sql`(SELECT COUNT(*) FROM channel_members ci WHERE ci.channel_id = ${schema.channels.id}) = 2`,
        ),
      )
      .get()?.channel ?? null
  );
}

export function listDmChannels(userId: string): DmChannel[] {
  const rows = db
    .select({ channel: schema.channels })
    .from(schema.channels)
    .innerJoin(schema.channelMembers, eq(schema.channelMembers.channelId, schema.channels.id))
    .where(and(eq(schema.channels.kind, 'dm'), eq(schema.channelMembers.userId, userId)))
    .all()
    .map((row) => row.channel);

  return rows
    .map((row) => {
      const recipients = recipientsOf(row.id);
      // the person who blocked sees the conversation gone; the blocked side keeps the history
      const blocked = recipients.some((user) => blocksBetween(userId, user.id));
      return { ...toDmChannel(row, recipients, lastMessageAt(row.id)), blocked };
    })
    // a blocked conversation stays on disk but stops being offered in the list
    .filter((dm) => !dm.blocked)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
}

export function openDirectChannel(user: UserRow, targetId: string): DmChannel {
  if (targetId === user.id) throw badRequest('Você não pode abrir uma conversa consigo mesmo.');
  const target = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get();
  if (!target) throw notFound('Usuário não encontrado.');
  assertDmAllowed(user.id, target.id);

  const existing = findDirectChannel(user.id, target.id);
  if (existing) return toDmChannel(existing, recipientsOf(existing.id), lastMessageAt(existing.id));

  const row: ChannelRow = {
    id: newId(),
    kind: 'dm',
    guildId: null,
    name: `${user.username}-${target.username}`,
    topic: null,
    type: 'text',
    position: 0,
    userLimit: 0,
    categoryId: null,
    private: false,
    createdAt: nowIso(),
  };

  db.transaction((tx) => {
    tx.insert(schema.channels).values(row).run();
    tx.insert(schema.channelMembers)
      .values([
        { channelId: row.id, userId: user.id },
        { channelId: row.id, userId: target.id },
      ])
      .run();
  });

  const ownView = toDmChannel(row, [target], null);
  const targetView = toDmChannel(row, [user], null);
  hub.emitToUsers([user.id], { type: 'dm:create', dm: ownView });
  hub.emitToUsers([target.id], { type: 'dm:create', dm: targetView });
  hub.syncUserRooms(user.id);
  hub.syncUserRooms(target.id);
  return ownView;
}
