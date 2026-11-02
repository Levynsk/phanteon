import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { hub } = await import('../src/realtime/hub');
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

  test('joining a different guild leaves the previous call and broadcasts coherent state', async () => {
    const firstOwner = await client.register();
    const secondOwner = await client.register();
    const member = await client.register();
    const firstGuildId = await helpers.sharedGuild(client, firstOwner, member);
    const secondGuildId = await helpers.sharedGuild(client, secondOwner, member);
    const firstVoiceId = await helpers.createVoiceChannel(client, firstOwner, firstGuildId);
    const secondVoiceId = await helpers.createVoiceChannel(client, secondOwner, secondGuildId);

    await client.call('POST', `/api/voice/channels/${firstVoiceId}/join`, { token: member.token });

    const events: { recipients: string[]; event: { type: string; guildId?: string; channelId?: string; state?: { channelId: string; user: { id: string } } } }[] = [];
    const proto = Object.getPrototypeOf(hub) as { emitToUsers: typeof hub.emitToUsers };
    const original = proto.emitToUsers;
    proto.emitToUsers = function (this: unknown, recipients, event) {
      events.push({ recipients: [...recipients], event: event as never });
      return original.call(this, recipients, event);
    };
    try {
      const joined = await client.call('POST', `/api/voice/channels/${secondVoiceId}/join`, { token: member.token });
      expect(joined.status).toBe(200);
    } finally {
      proto.emitToUsers = original;
    }

    const statesInFirstGuild = (await client.call('GET', `/api/voice/guilds/${firstGuildId}`, { token: firstOwner.token })).body.states;
    const statesInSecondGuild = (await client.call('GET', `/api/voice/guilds/${secondGuildId}`, { token: secondOwner.token })).body.states;
    expect(statesInFirstGuild.some((state: { user: { id: string } }) => state.user.id === member.user.id)).toBe(false);
    expect(statesInSecondGuild.filter((state: { user: { id: string } }) => state.user.id === member.user.id)).toHaveLength(1);
    expect(statesInSecondGuild.find((state: { user: { id: string } }) => state.user.id === member.user.id).channelId).toBe(secondVoiceId);

    expect(events.filter(({ event }) => event.type === 'voice:leave')).toContainEqual({
      recipients: expect.arrayContaining([firstOwner.user.id, member.user.id]),
      event: { type: 'voice:leave', guildId: firstGuildId, channelId: firstVoiceId, userId: member.user.id },
    });
    expect(events.some(({ recipients, event }) =>
      recipients.includes(secondOwner.user.id) && event.type === 'voice:state' &&
      event.state?.user.id === member.user.id && event.state.channelId === secondVoiceId,
    )).toBe(true);
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
