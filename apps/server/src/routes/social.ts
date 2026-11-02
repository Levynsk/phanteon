import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../http/context';
import { jsonBody } from '../http/validation';
import { hidden } from '../http/errors';
import { findVisibleDirectChannel, listDmChannels, openDirectChannel } from '../services/dms';
import { toggleReaction } from '../services/messages';
import type { GuildMember } from '@phanteon/shared';
import { toGuildMember, toPublicUser } from '../db/mappers';
import { db, schema } from '../db/client';
import { and, eq, sql } from 'drizzle-orm';
import { hub } from '../realtime/hub';
import { getGuildRow } from '../services/guilds';
import { sharedRuntimeUserIds } from '../realtime/audience';
import { memberRolesOf, resolveMemberPermissions } from '../services/roles';

const openSchema = z.object({ userId: z.string().min(1, 'Selecione um usuário.') });
const reactionSchema = z.object({ emoji: z.string().trim().min(1).max(32) });

export const dmRoutes = new Hono<{ Variables: AppVariables }>();

dmRoutes.get('/', (c) => c.json({ dms: listDmChannels(c.get('currentUser').id) }));

dmRoutes.post('/', jsonBody(openSchema), (c) => {
  const dm = openDirectChannel(c.get('currentUser'), c.req.valid('json').userId);
  return c.json({ dm }, 201);
});

dmRoutes.get('/with/:userId', (c) => {
  const me = c.get('currentUser').id;
  const otherId = c.req.param('userId');
  // the same answer for "unknown user", "no conversation" and "blocked": no directory
  const user = db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, otherId)).get();
  if (!user) throw hidden('Usuário não encontrado.');
  const row = findVisibleDirectChannel(me, otherId);
  return c.json({ channelId: row?.id ?? null });
});

export const reactionRoutes = new Hono<{ Variables: AppVariables }>();

reactionRoutes.put('/:messageId', jsonBody(reactionSchema), (c) => {
  const payload = toggleReaction(c.get('currentUser'), c.req.param('messageId'), c.req.valid('json').emoji);
  return c.json(payload);
});

export const presenceRoutes = new Hono<{ Variables: AppVariables }>();

/** Only people the viewer already shares a server or a DM with; the rest is none of their business. */
presenceRoutes.get('/online', (c) => {
  const audience = new Set(sharedRuntimeUserIds(c.get('currentUser').id));
  return c.json({ userIds: hub.onlineUserIds().filter((userId) => audience.has(userId)) });
});

export const memberRoutes = new Hono<{ Variables: AppVariables }>();

type CounterpartSource = { guildId: string; role: GuildMember['role']; joinedAt: string };

function sharedMembership(viewerId: string, userId: string): CounterpartSource | null {
  const row = db
    .select({ member: schema.guildMembers })
    .from(schema.guildMembers)
    .where(
      and(
        eq(schema.guildMembers.userId, userId),
        sql`${schema.guildMembers.guildId} IN (SELECT guild_id FROM guild_members WHERE user_id = ${viewerId})`,
      ),
    )
    .get();
  return row ? row.member : null;
}

function sharesDm(viewerId: string, userId: string): boolean {
  return Boolean(
    db
      .select({ channelId: schema.channelMembers.channelId })
      .from(schema.channelMembers)
      .innerJoin(schema.channels, eq(schema.channels.id, schema.channelMembers.channelId))
      .where(
        and(
          eq(schema.channelMembers.userId, userId),
          eq(schema.channels.kind, 'dm'),
          sql`${schema.channelMembers.channelId} IN (SELECT channel_id FROM channel_members WHERE user_id = ${viewerId})`,
        ),
      )
      .get(),
  );
}

/** Profile card for any user the viewer shares a server or DM with. */
memberRoutes.get('/:userId', (c) => {
  const me = c.get('currentUser');
  const userId = c.req.param('userId');

  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return c.json({ member: null });

  const membership = sharedMembership(me.id, userId);
  if (!membership && userId !== me.id && !sharesDm(me.id, userId)) {
    return c.json({ member: null });
  }

  const roleIds = membership ? memberRolesOf(membership.guildId, user.id).map((role) => role.id) : [];
  const member: GuildMember = {
    guildId: membership?.guildId ?? '',
    role: membership?.role ?? 'member',
    joinedAt: membership?.joinedAt ?? user.createdAt,
    user: toPublicUser(user),
    online: hub.isUserOnline(user.id),
    roleIds,
    position: membership ? resolveMemberPermissions(getGuildRow(membership.guildId), user.id).position : 0,
  };
  return c.json({ member });
});
