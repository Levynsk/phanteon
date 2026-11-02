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

async function newGuild(owner: { token: string }, name = 'Invite Guild') {
  const res = await client.call('POST', '/api/guilds', { token: owner.token, body: { name } });
  return res.body.guild.id as string;
}

describe('guild invites', () => {
  test('a plain invite is unlimited and never expires', async () => {
    const owner = await client.register();
    const guildId = await newGuild(owner);

    const created = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
    expect(created.status).toBe(201);
    expect(created.body.invite.maxUses).toBe(0);
    expect(created.body.invite.expiresAt).toBeNull();
    expect(created.body.invite.active).toBe(true);

    const listed = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: owner.token });
    expect(listed.body.invites).toHaveLength(1);
    expect(listed.body.invites[0].code).toBe(created.body.invite.code);
    expect(listed.body.invites[0].inviter.id).toBe(owner.user.id);
  });

  test('maxUses is enforced and the invite is reported as exhausted', async () => {
    const owner = await client.register();
    const first = await client.register();
    const second = await client.register();
    const guildId = await newGuild(owner);

    const created = await client.call('POST', `/api/guilds/${guildId}/invites`, {
      token: owner.token,
      body: { maxUses: 1 },
    });
    const code = created.body.invite.code as string;

    const ok = await client.call('POST', '/api/guilds/join', { token: first.token, body: { code } });
    expect(ok.status).toBe(200);

    const full = await client.call('POST', '/api/guilds/join', { token: second.token, body: { code } });
    // an exhausted invite is indistinguishable from an unknown code
    expect(full.status).toBe(404);
    expect(full.body.error.message).toContain('Convite inválido ou expirado');

    const listed = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: owner.token });
    expect(listed.body.invites[0].uses).toBe(1);
    expect(listed.body.invites[0].active).toBe(false);
  });

  test('a timed invite stops working after it expires', async () => {
    const owner = await client.register();
    const guest = await client.register();
    const guildId = await newGuild(owner);

    const created = await client.call('POST', `/api/guilds/${guildId}/invites`, {
      token: owner.token,
      body: { durationMs: 400 },
    });
    const code = created.body.invite.code as string;
    expect(created.body.invite.active).toBe(true);

    await Bun.sleep(500);

    const join = await client.call('POST', '/api/guilds/join', { token: guest.token, body: { code } });
    // expired and unknown codes answer identically
    expect(join.status).toBe(404);
    expect(join.body.error.message).toContain('Convite inválido ou expirado');

    const listed = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: owner.token });
    expect(listed.body.invites[0].active).toBe(false);
  });

  test('revoking an invite makes the code unusable and drops it from the list', async () => {
    const owner = await client.register();
    const guest = await client.register();
    const guildId = await newGuild(owner);

    const created = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
    const code = created.body.invite.code as string;

    const revoked = await client.call('DELETE', `/api/invites/${code}`, { token: owner.token });
    expect(revoked.status).toBe(204);

    const listed = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: owner.token });
    expect(listed.body.invites).toHaveLength(0);

    const join = await client.call('POST', '/api/guilds/join', { token: guest.token, body: { code } });
    expect(join.status).toBe(404);
  });

  test('a member sees only their invites and cannot revoke someone else’s', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);

    const ownerInvite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
    const memberInvite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: member.token });

    const memberList = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: member.token });
    expect(memberList.body.invites.map((invite: { code: string }) => invite.code)).toEqual([
      memberInvite.body.invite.code,
    ]);

    const ownerList = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: owner.token });
    // sharedGuild already created one invite to move the member in
    expect(ownerList.body.invites).toHaveLength(3);

    const denied = await client.call('DELETE', `/api/invites/${ownerInvite.body.invite.code}`, {
      token: member.token,
    });
    // someone else's invite answers like a missing code, not like a forbidden one
    expect(denied.status).toBe(404);

    const own = await client.call('DELETE', `/api/invites/${memberInvite.body.invite.code}`, {
      token: member.token,
    });
    expect(own.status).toBe(204);
  });

  test('invalid options and outsiders are rejected', async () => {
    const owner = await client.register();
    const outsider = await client.register();
    const guildId = await newGuild(owner);

    const tooMany = await client.call('POST', `/api/guilds/${guildId}/invites`, {
      token: owner.token,
      body: { maxUses: 500 },
    });
    expect(tooMany.status).toBe(400);

    const tooLong = await client.call('POST', `/api/guilds/${guildId}/invites`, {
      token: owner.token,
      body: { durationMs: 90 * 24 * 60 * 60 * 1000 },
    });
    expect(tooLong.status).toBe(400);

    const outside = await client.call('GET', `/api/guilds/${guildId}/invites`, { token: outsider.token });
    expect(outside.status).toBe(403);
  });
});
