import { beforeAll, describe, expect, test } from 'bun:test';
import { Permission } from '@phanteon/shared';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

async function logs(token: string, guildId: string, query = '') {
  return client.call('GET', `/api/guilds/${guildId}/audit-logs${query}`, { token });
}

describe('guild audit log', () => {
  test('records moderation actions newest first with actor and target', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);

    await client.call('POST', `/api/guilds/${guildId}/channels`, { token: owner.token, body: { name: 'novo' } });
    await client.call('PUT', `/api/guilds/${guildId}/bans/${member.user.id}`, {
      token: owner.token,
      body: { reason: 'spam' },
    });
    await client.call('DELETE', `/api/guilds/${guildId}/bans/${member.user.id}`, { token: owner.token });

    const res = await logs(owner.token, guildId);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(4);

    const actions = res.body.entries.map((entry: { action: string }) => entry.action);
    expect(actions.slice(0, 3)).toEqual(['member.unban', 'member.ban', 'channel.create']);

    const ban = res.body.entries.find((entry: { action: string }) => entry.action === 'member.ban');
    expect(ban.actor.id).toBe(owner.user.id);
    expect(ban.targetId).toBe(member.user.id);
    expect(ban.targetName).toBeTruthy();
    expect(ban.reason).toContain('spam');

    // chat messages are not audit material
    expect(actions).not.toContain('message.create');
  });

  test('filter by action and by target user', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    await client.call('DELETE', `/api/guilds/${guildId}/members/${member.user.id}`, { token: owner.token });

    const kickOnly = await logs(owner.token, guildId, '?action=member.kick');
    expect(kickOnly.body.entries).toHaveLength(1);
    expect(kickOnly.body.entries[0].targetId).toBe(member.user.id);

    const byTarget = await logs(owner.token, guildId, `?targetId=${member.user.id}`);
    expect(byTarget.body.entries.every((entry: { targetId: string }) => entry.targetId === member.user.id)).toBe(true);

    const unknown = await logs(owner.token, guildId, '?action=message.create');
    expect(unknown.status).toBe(400);
  });

  test('pages with a cursor and reports the total', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());

    for (let index = 0; index < 5; index += 1) {
      await client.call('POST', `/api/guilds/${guildId}/channels`, {
        token: owner.token,
        body: { name: `sala-${index}` },
      });
    }

    const first = await logs(owner.token, guildId, '?limit=2&action=channel.create');
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    // the guild itself ships with a default text channel, also logged
    expect(first.body.total).toBe(6);
    expect(first.body.entries.every((entry: { action: string }) => entry.action === 'channel.create')).toBe(true);

    const second = await logs(owner.token, guildId, `?limit=2&action=channel.create&before=${first.body.nextCursor}`);
    expect(second.body.entries).toHaveLength(2);
    const ids = new Set([
      ...first.body.entries.map((entry: { id: string }) => entry.id),
      ...second.body.entries.map((entry: { id: string }) => entry.id),
    ]);
    expect(ids.size).toBe(4);

    const badCursor = await logs(owner.token, guildId, '?before=nope');
    expect(badCursor.status).toBe(400);
  });

  test('requires the ViewAuditLog permission', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);

    const denied = await logs(member.token, guildId);
    expect(denied.status).toBe(403);

    const roles = await client.call('GET', `/api/guilds/${guildId}/roles`, { token: owner.token });
    const adminRole = roles.body.roles.find((role: { name: string }) => role.name === 'Administrador');
    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${member.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [adminRole.id] },
    });

    // the admin role carries AllowAll flags including ViewAuditLog
    const allowed = await logs(member.token, guildId);
    expect(allowed.status).toBe(200);
    expect((adminRole.permissions & Permission.ViewAuditLog) === Permission.ViewAuditLog).toBe(true);
  });
});
