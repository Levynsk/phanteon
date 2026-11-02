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

const EVERYONE = '@everyone';

describe('voice channel configuration', () => {
  test('user limit blocks extra members but not moderators', async () => {
    const owner = await client.register();
    const a = await client.register();
    const b = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, a);
    await client.call('POST', '/api/guilds/join', {
      token: b.token,
      body: { code: (await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token })).body.invite.code },
    });
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    const configured = await client.call('PATCH', `/api/channels/${voiceId}`, { token: owner.token, body: { userLimit: 1 } });
    expect(configured.status).toBe(200);
    expect(configured.body.channel.userLimit).toBe(1);

    const first = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: a.token });
    expect(first.status).toBe(200);

    const second = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: b.token });
    expect(second.status).toBe(400);

    // the owner holds MoveMembers through the system role, so they can still join
    const moderator = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: owner.token });
    expect(moderator.status).toBe(200);
  });

  test('@everyone override denying Connect keeps members out', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    const patched = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: EVERYONE, allow: 0, deny: Permission.Connect | Permission.Speak }] },
    });
    expect(patched.status).toBe(200);

    const denied = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });
    expect(denied.status).toBe(403);

    // the owner bypasses overrides
    const ownerJoin = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: owner.token });
    expect(ownerJoin.status).toBe(200);
  });

  test('toggling the override back lets members join again', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: EVERYONE, allow: 0, deny: Permission.Connect }] },
    });
    expect((await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token })).status).toBe(403);

    await client.call('PATCH', `/api/channels/${voiceId}`, { token: owner.token, body: { overrides: [] } });
    expect((await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token })).status).toBe(200);
  });

  test('override written to the channel is returned for the settings screen', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: EVERYONE, allow: Permission.Speak, deny: 0 }] },
    });

    const read = await client.call('GET', `/api/channels/${voiceId}`, { token: owner.token });
    expect(read.status).toBe(200);
    expect(read.body.overrides).toHaveLength(1);
    expect(read.body.overrides[0].allow).toBe(Permission.Speak);
  });

  test('per-channel overrides are rejected on text channels and bad limits', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const text = (await helpers.guildChannels(client, owner.token, guildId)).find((channel) => channel.type === 'text')!;

    const overrides = await client.call('PATCH', `/api/channels/${text.id}`, {
      token: owner.token,
      body: { overrides: [{ roleId: EVERYONE, allow: 0, deny: Permission.ViewChannel }] },
    });
    expect(overrides.status).toBe(400);

    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    const badLimit = await client.call('PATCH', `/api/channels/${voiceId}`, { token: owner.token, body: { userLimit: 150 } });
    expect(badLimit.status).toBe(400);
  });
});
