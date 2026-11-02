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

describe('voice channels', () => {
  test('join returns a state and it is listed to guild members', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    const joined = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });
    expect(joined.status).toBe(200);
    expect(joined.body.state.channelId).toBe(voiceId);
    expect(joined.body.state.serverMute).toBe(false);

    const listed = await client.call('GET', `/api/voice/guilds/${guildId}`, { token: owner.token });
    expect(listed.status).toBe(200);
    expect(listed.body.states.map((state: { user: { id: string } }) => state.user.id)).toContain(member.user.id);
  });

  test('rejects text channels and non-members', async () => {
    const owner = await client.register();
    const outsider = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, outsider);
    const outsiderB = await client.register();
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    const textChannel = (await helpers.guildChannels(client, owner.token, guildId)).find(
      (channel) => channel.type === 'text',
    )!;
    const onText = await client.call('POST', `/api/voice/channels/${textChannel.id}/join`, { token: owner.token });
    expect(onText.status).toBe(400);

    const notMember = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: outsiderB.token });
    expect(notMember.status).toBe(403);
  });

  test('self mute only changes the caller state', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    const muted = await client.call('PATCH', '/api/voice/@me', { token: member.token, body: { selfMute: true } });
    expect(muted.status).toBe(200);
    expect(muted.body.state.selfMute).toBe(true);

    const notInCall = await client.call('PATCH', '/api/voice/@me', { token: owner.token, body: { selfMute: true } });
    expect(notInCall.status).toBe(400);
  });

  test('server mute requires the permission and forces self mute', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);

    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: owner.token });
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    // a plain member cannot mute the owner
    const forbidden = await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${owner.user.id}`, {
      token: member.token,
      body: { action: 'serverMute' },
    });
    expect(forbidden.status).toBe(403);

    const muted = await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${member.user.id}`, {
      token: owner.token,
      body: { action: 'serverMute' },
    });
    expect(muted.status).toBe(204);

    const states = (await client.call('GET', `/api/voice/guilds/${guildId}`, { token: owner.token })).body.states;
    const target = states.find((state: { user: { id: string } }) => state.user.id === member.user.id);
    expect(target.serverMute).toBe(true);
    expect(target.selfMute).toBe(true);

    // unmute restores transmission
    await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${member.user.id}`, {
      token: owner.token,
      body: { action: 'serverMute' },
    });
    const after = (await client.call('GET', `/api/voice/guilds/${guildId}`, { token: owner.token })).body.states;
    expect(after.find((state: { user: { id: string } }) => state.user.id === member.user.id).serverMute).toBe(false);
  });

  test('leave removes the state', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: owner.token });

    const left = await client.call('POST', `/api/voice/guilds/${guildId}/leave`, { token: owner.token });
    expect(left.status).toBe(204);

    const states = (await client.call('GET', `/api/voice/guilds/${guildId}`, { token: owner.token })).body.states;
    expect(states).toHaveLength(0);
  });
});
