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

async function inviteCode(guildId: string, token: string): Promise<string> {
  const res = await client.call('POST', `/api/guilds/${guildId}/invites`, { token });
  return res.body.invite.code as string;
}

describe('guild bans', () => {
  test('permanent ban removes the member, blocks invites and is listed', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const code = await inviteCode(guildId, owner.token);

    const banned = await client.call('PUT', `/api/guilds/${guildId}/bans/${member.user.id}`, {
      token: owner.token,
      body: { reason: 'spam' },
    });
    expect(banned.status).toBe(200);
    expect(banned.body.ban.user.id).toBe(member.user.id);
    expect(banned.body.ban.reason).toBe('spam');
    expect(banned.body.ban.expiresAt).toBeNull();
    expect(banned.body.ban.moderator.id).toBe(owner.user.id);

    const guild = await client.call('GET', `/api/guilds/${guildId}`, { token: owner.token });
    expect(guild.body.guild.members.some((m: { user: { id: string } }) => m.user.id === member.user.id)).toBe(false);

    const rejoin = await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } });
    // a ban answers like a dead invite, so it does not confirm the guild exists
    expect(rejoin.status).toBe(404);
    expect(rejoin.body.error.message).toContain('Convite inválido ou expirado');

    const listed = await client.call('GET', `/api/guilds/${guildId}/bans`, { token: owner.token });
    expect(listed.status).toBe(200);
    expect(listed.body.bans).toHaveLength(1);
    expect(listed.body.bans[0].user.id).toBe(member.user.id);
  });

  test('revoking a ban lets the user come back through an invite', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const code = await inviteCode(guildId, owner.token);

    await client.call('PUT', `/api/guilds/${guildId}/bans/${member.user.id}`, { token: owner.token, body: {} });
    expect((await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } })).status).toBe(404);

    const revoked = await client.call('DELETE', `/api/guilds/${guildId}/bans/${member.user.id}`, { token: owner.token });
    expect(revoked.status).toBe(204);

    const listed = await client.call('GET', `/api/guilds/${guildId}/bans`, { token: owner.token });
    expect(listed.body.bans).toHaveLength(0);

    const rejoin = await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } });
    expect(rejoin.status).toBe(200);
  });

  test('a timed ban expires and stops blocking', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const code = await inviteCode(guildId, owner.token);

    const banned = await client.call('PUT', `/api/guilds/${guildId}/bans/${member.user.id}`, {
      token: owner.token,
      body: { durationMs: 1000, reason: 'flood' },
    });
    expect(banned.status).toBe(200);
    expect(typeof banned.body.ban.expiresAt).toBe('string');
    expect((await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } })).status).toBe(404);

    await Bun.sleep(1100);

    // expired rows are pruned on read, so the list is empty again
    const listed = await client.call('GET', `/api/guilds/${guildId}/bans`, { token: owner.token });
    expect(listed.body.bans).toHaveLength(0);

    const rejoin = await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } });
    expect(rejoin.status).toBe(200);
  });

  test('an expired ban never blocks the join, even before the list is read', async () => {
    const owner = await client.register();
    const stranger = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const code = await inviteCode(guildId, owner.token);

    await client.call('PUT', `/api/guilds/${guildId}/bans/${stranger.user.id}`, {
      token: owner.token,
      body: { durationMs: 300 },
    });
    await Bun.sleep(400);

    const rejoin = await client.call('POST', '/api/guilds/join', { token: stranger.token, body: { code } });
    expect(rejoin.status).toBe(200);
  });

  test('permissions and target rules are enforced', async () => {
    const owner = await client.register();
    const member = await client.register();
    const other = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    await client.call('POST', '/api/guilds/join', {
      token: other.token,
      body: { code: await inviteCode(guildId, owner.token) },
    });

    const noPerm = await client.call('PUT', `/api/guilds/${guildId}/bans/${other.user.id}`, {
      token: member.token,
      body: {},
    });
    expect(noPerm.status).toBe(403);

    const listDenied = await client.call('GET', `/api/guilds/${guildId}/bans`, { token: member.token });
    expect(listDenied.status).toBe(403);

    const self = await client.call('PUT', `/api/guilds/${guildId}/bans/${owner.user.id}`, {
      token: owner.token,
      body: {},
    });
    expect(self.status).toBe(400);

    const outsider = await client.register();
    const outsiderTry = await client.call('PUT', `/api/guilds/${guildId}/bans/${other.user.id}`, {
      token: outsider.token,
      body: {},
    });
    expect(outsiderTry.status).toBe(403);
  });

  test('an admin cannot ban someone above them but can ban a regular member', async () => {
    const owner = await client.register();
    const admin = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, admin);
    await client.call('POST', '/api/guilds/join', {
      token: member.token,
      body: { code: await inviteCode(guildId, owner.token) },
    });

    const roles = await client.call('GET', `/api/guilds/${guildId}/roles`, { token: owner.token });
    const adminRole = roles.body.roles.find((role: { name: string }) => role.name === 'Administrador');
    const assigned = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${admin.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [adminRole.id] },
    });
    expect(assigned.status).toBe(200);

    const againstOwner = await client.call('PUT', `/api/guilds/${guildId}/bans/${owner.user.id}`, {
      token: admin.token,
      body: {},
    });
    expect(againstOwner.status).toBe(403);

    const ok = await client.call('PUT', `/api/guilds/${guildId}/bans/${member.user.id}`, {
      token: admin.token,
      body: { reason: 'regra 1' },
    });
    expect(ok.status).toBe(200);
  });
});
