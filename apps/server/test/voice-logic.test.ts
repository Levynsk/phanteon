import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Permission } from '@phanteon/shared';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { db, schema } = await import('../src/db/client');
const { leaveVoiceOnDisconnect, listGuildVoiceStates } = await import('../src/services/voice');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);
const cap = Permission.MuteMembers;
const EVERYONE = '@everyone';

beforeAll(() => {
  migrate();
});

async function callWith(owner: Awaited<ReturnType<typeof client.register>>, member: typeof owner) {
  const guildId = await helpers.sharedGuild(client, owner, member);
  const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
  return { guildId, voiceId };
}


describe('voice logic', () => {
  test('a deafened user cannot unmute their own microphone', async () => {
    const owner = await client.register();
    const member = await client.register();
    const { voiceId } = await callWith(owner, member);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    const deaf = await client.call('PATCH', '/api/voice/@me', { token: member.token, body: { selfMute: true, selfDeaf: true } });
    expect(deaf.body.state.selfMute).toBe(true);

    const unmute = await client.call('PATCH', '/api/voice/@me', {
      token: member.token,
      body: { selfMute: false, selfDeaf: true },
    });
    expect(unmute.body.state.selfMute).toBe(true);

    // undeafening returns the choice to the user
    const awake = await client.call('PATCH', '/api/voice/@me', {
      token: member.token,
      body: { selfDeaf: false, selfMute: false },
    });
    expect(awake.body.state.selfMute).toBe(false);
  });

  test('a server-deafened user cannot undeafen themselves', async () => {
    const owner = await client.register();
    const member = await client.register();
    const { guildId, voiceId } = await callWith(owner, member);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${member.user.id}`, {
      token: owner.token,
      body: { action: 'serverDeaf' },
    });
    const self = await client.call('PATCH', '/api/voice/@me', { token: member.token, body: { selfDeaf: false } });
    expect(self.body.state.selfDeaf).toBe(true);
    expect(self.body.state.selfMute).toBe(true);
  });

  test('hopping channels does not wipe a self mute or deafen', async () => {
    const owner = await client.register();
    const member = await client.register();
    const { guildId, voiceId } = await callWith(owner, member);
    const second = await helpers.createVoiceChannel(client, owner, guildId);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });
    await client.call('PATCH', '/api/voice/@me', { token: member.token, body: { selfMute: true, selfDeaf: true } });

    const moved = await client.call('POST', `/api/voice/channels/${second}/join`, { token: member.token });
    expect(moved.status).toBe(200);
    expect(moved.body.state.channelId).toBe(second);
    // deafened implies muted, and the deaf flag itself must survive the hop
    expect(moved.body.state.selfMute).toBe(true);
    expect(moved.body.state.selfDeaf).toBe(true);
  });

  test('a channel without Speak forces mute when joining', async () => {
    const owner = await client.register();
    const member = await client.register();
    const { guildId, voiceId } = await callWith(owner, member);
    await helpers.createVoiceChannel(client, owner, guildId);
    const patched = await client.call('PATCH', `/api/channels/${voiceId}`, {
      token: owner.token,
      body: { overrides: [{ roleId: '@everyone', allow: 0, deny: Permission.Speak }] },
    });
    expect(patched.status).toBe(200);

    const joined = await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });
    expect(joined.status).toBe(200);
    expect(joined.body.state.selfMute).toBe(true);

    const unmute = await client.call('PATCH', '/api/voice/@me', { token: member.token, body: { selfMute: false } });
    expect(unmute.body.state.selfMute).toBe(true);
  });

  test('leaving on socket disconnect clears every seated guild', async () => {
    const member = await client.register();
    const first = await client.register();
    const second = await client.register();
    const guildA = await helpers.sharedGuild(client, first, member);
    const guildB = await helpers.sharedGuild(client, second, member);
    const voiceA = await helpers.createVoiceChannel(client, first, guildA);
    const voiceB = await helpers.createVoiceChannel(client, second, guildB);
    await client.call('POST', `/api/voice/channels/${voiceA}/join`, { token: member.token });
    await client.call('POST', `/api/voice/channels/${voiceB}/join`, { token: member.token });

    // joining another guild first broadcasts/removes the previous seat
    expect(listGuildVoiceStates(guildA, first.user.id)).toHaveLength(0);
    expect(listGuildVoiceStates(guildB, second.user.id)).toHaveLength(1);

    leaveVoiceOnDisconnect(member.user.id);
    expect(listGuildVoiceStates(guildA, first.user.id)).toHaveLength(0);
    expect(listGuildVoiceStates(guildB, second.user.id)).toHaveLength(0);
  });

  test('moderation needs only the flag its action uses', async () => {
    const owner = await client.register();
    const member = await client.register();
    const actor = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    await client.call('POST', '/api/guilds/join', {
      token: actor.token,
      body: { code: (await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token })).body.invite.code },
    });
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    // a "voice-only mute" role: MuteMembers granted, MoveMembers (system) not
    const role = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Mute only', permissions: cap },
    });
    expect(role.status).toBe(201);
    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${actor.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [role.body.role.id] },
    });

    const mute = await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${member.user.id}`, {
      token: actor.token,
      body: { action: 'serverMute' },
    });
    expect(mute.status).toBe(204);
    const disconnect = await client.call('PATCH', `/api/voice/guilds/${guildId}/members/${member.user.id}`, {
      token: actor.token,
      body: { action: 'disconnect' },
    });
    expect(disconnect.status).toBe(403);
  });

  test('a stale call seat does not resurrect the user on reconnect', async () => {
    const owner = await client.register();
    const member = await client.register();
    const { voiceId } = await callWith(owner, member);
    await client.call('POST', `/api/voice/channels/${voiceId}/join`, { token: member.token });

    db.delete(schema.voiceStates).where(eq(schema.voiceStates.userId, member.user.id)).run();
    leaveVoiceOnDisconnect(member.user.id);
    const sync = (await client.call('GET', '/api/voice', { token: member.token })).body.states;
    expect(sync).toHaveLength(0);
  });
});
