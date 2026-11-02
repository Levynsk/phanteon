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

type TestClient = Awaited<ReturnType<typeof client.register>>;

/** Adds `actor` to the guild through an invite and gives them a role with `permissions`. */
async function joinWithRole(owner: TestClient, guildId: string, permissions: number, name: string): Promise<TestClient> {
  const actor = await client.register();
  const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
  await client.call('POST', '/api/guilds/join', { token: actor.token, body: { code: invite.body.invite.code } });
  const role = await client.call('POST', `/api/guilds/${guildId}/roles`, {
    token: owner.token,
    body: { name, permissions },
  });
  await client.call('PUT', `/api/guilds/${guildId}/member-roles/${actor.user.id}/roles`, {
    token: owner.token,
    body: { roleIds: [role.body.role.id] },
  });
  return actor;
}

async function guildWithMember() {
  const owner = await client.register();
  const member = await client.register();
  const guildId = await helpers.sharedGuild(client, owner, member);
  const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
  // overrides name roles by id, so resolve the guild's own @everyone row
  const details = await client.call('GET', `/api/guilds/${guildId}`, { token: owner.token });
  const everyone = (details.body.guild.roles as { id: string; name: string; isEveryone?: boolean }[]).find(
    (role) => role.isEveryone || role.name === '@everyone',
  )!.id;
  return { owner, member, guildId, voiceId, everyone };
}

describe('channel permission overrides', () => {
  test('a manager cannot grant permissions they do not hold', async () => {
    const { owner, guildId, voiceId, everyone } = await guildWithMember();
    const manage = await joinWithRole(owner, guildId, Permission.ManageChannels | Permission.Connect, 'gerente');

    const escalate = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: manage.token,
      body: { overrides: [{ roleId: everyone, allow: Permission.ManageRoles | Permission.BanMembers, deny: 0 }] },
    });
    expect(escalate.status).toBe(403);

    // Connect is within the actor's own permissions, so the same shape works
    const allowed = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: manage.token,
      body: { overrides: [{ roleId: everyone, allow: Permission.Connect, deny: Permission.Speak }] },
    });
    expect(allowed.status).toBe(200);
  });

  test('an override for a role from another guild is rejected', async () => {
    const { owner, guildId, voiceId, everyone } = await guildWithMember();
    const otherOwner = await client.register();
    const otherGuild = await helpers.sharedGuild(client, otherOwner, await client.register());
    const foreign = await client.call('POST', `/api/guilds/${otherGuild}/roles`, {
      token: otherOwner.token,
      body: { name: 'estranho', permissions: Permission.Connect },
    });

    const patched = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: foreign.body.role.id, allow: 0, deny: Permission.Connect }] },
    });
    expect(patched.status).toBe(404);

    // nothing was written: the voice channel still lists no overrides
    const details = await client.call('GET', `/api/guilds/${guildId}`, { token: owner.token });
    const channel = (details.body.guild.channels as { id: string; overrides?: unknown[] }[]).find(
      (entry) => entry.id === voiceId,
    );
    expect(channel?.overrides ?? []).toHaveLength(0);
  });

  test('the same role listed twice is rejected', async () => {
    const { owner, voiceId, everyone } = await guildWithMember();
    const patched = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: {
        overrides: [
          { roleId: everyone, allow: 0, deny: Permission.Speak },
          { roleId: everyone, allow: Permission.Speak, deny: 0 },
        ],
      },
    });
    expect(patched.status).toBe(400);
  });
});

describe('voice Connect/Speak switches round trip', () => {
  test('denying @everyone and then re-allowing restores access', async () => {
    const { owner, member, voiceId, everyone } = await guildWithMember();
    const denyAll = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: everyone, allow: 0, deny: Permission.Connect | Permission.Speak }] },
    });
    expect(denyAll.status).toBe(200);
    expect((await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token })).status).toBe(403);

    // the dialog now always sends the @everyone override, with allow set and deny cleared
    const reallow = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: everyone, allow: Permission.Connect | Permission.Speak, deny: 0 }] },
    });
    expect(reallow.status).toBe(200);
    expect((await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token })).status).toBe(200);
  });
});
