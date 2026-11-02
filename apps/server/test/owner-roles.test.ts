import { beforeAll, describe, expect, test } from 'bun:test';
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

describe('owner roles', () => {
  test('the owner can wear a cosmetic role, but nobody else can assign them one', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);

    const created = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Fundadora', color: '#f472b6' },
    });
    expect(created.status).toBe(201);
    const roleId = created.body.role.id as string;

    // a regular member with every moderation permission still cannot touch the owner's roles
    const admin = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Staff', permissions: 0xfffff },
    });
    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${member.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [admin.body.role.id] },
    });
    const denied = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${owner.user.id}/roles`, {
      token: member.token,
      body: { roleIds: [roleId] },
    });
    expect(denied.status).toBe(403);

    const assigned = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${owner.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [roleId] },
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.roleIds).toEqual([roleId]);

    const details = await client.call('GET', `/api/guilds/${guildId}`, { token: owner.token });
    const ownerMember = details.body.guild.members.find(
      (entry: { user: { id: string } }) => entry.user.id === owner.user.id,
    );
    expect(ownerMember.roleIds).toContain(roleId);
  });
});
