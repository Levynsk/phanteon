import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { PublicUser, VoiceState } from '@phanteon/shared';

const session = await import('../src/lib/voice-session');
const { useChatStore } = await import('../src/app/stores/chat');

function user(id: string): PublicUser {
  return {
    id,
    username: id,
    displayName: id,
    email: `${id}@test.local`,
    avatarUrl: null,
    bannerUrl: null,
    accentColor: null,
    status: 'online',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as PublicUser;
}

function voiceState(id: string, patch: Partial<VoiceState> = {}): VoiceState {
  return {
    channelId: 'call-a',
    guildId: 'guild-1',
    user: user(id),
    selfMute: false,
    selfDeaf: false,
    serverMute: false,
    serverDeaf: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as VoiceState;
}

const ME = 'me';
const PEER = 'peer';

type VoiceEvent = Extract<
  import('@phanteon/shared').ServerEvent,
  { type: 'voice:state' | 'voice:sync' | 'voice:leave' }
>;

let playback: ReturnType<typeof spyOn>;
let deafened: ReturnType<typeof spyOn>;
let reconcile: ReturnType<typeof spyOn>;
let disconnect: ReturnType<typeof spyOn>;

beforeEach(() => {
  // no RTC session runs in this test, so only the store's calls matter
  playback = spyOn(session, 'setPlaybackMuted').mockImplementation(() => {});
  deafened = spyOn(session, 'setSelfDeafened').mockImplementation(() => {});
  reconcile = spyOn(session, 'reconcileVoiceMesh').mockResolvedValue(undefined);
  disconnect = spyOn(session, 'disconnectVoicePeer').mockImplementation(() => {});
  useChatStore.getState().reset();
  useChatStore.setState({ voiceStates: {}, myVoice: { guildId: 'guild-1', channelId: 'call-a' } });
});

afterEach(() => {
  playback.mockRestore();
  deafened.mockRestore();
  reconcile.mockRestore();
  disconnect.mockRestore();
});

function lastReconciledPeers(): string[] | undefined {
  const calls = reconcile.mock.calls;
  return calls.length ? [...(calls[calls.length - 1][1] as string[])].sort() : undefined;
}

function lastPlayback(id: string): boolean | undefined {
  const calls = playback.mock.calls.filter((call: unknown[]) => call[0] === id);
  return calls.length ? Boolean(calls[calls.length - 1][1]) : undefined;
}

function handle(event: VoiceEvent) {
  (useChatStore.getState().handleEvent as (event: unknown, me: string) => void)(event, ME);
}

describe('voice store event handling', () => {
  test('a server-deafened peer stays silent when they toggle their own deafen', () => {
    handle({ type: 'voice:state', state: voiceState(PEER, { serverDeaf: true, selfDeaf: true }) });
    expect(lastPlayback(PEER)).toBe(true);

    // the peer undeafens themselves; the server still holds serverDeaf, so audio stays off
    handle({ type: 'voice:state', state: voiceState(PEER, { serverDeaf: true, selfDeaf: false }) });
    expect(lastPlayback(PEER)).toBe(true);
  });

  test('a deafened peer is muted locally and an undeafened one is heard again', () => {
    handle({ type: 'voice:state', state: voiceState(PEER, { selfDeaf: true }) });
    expect(lastPlayback(PEER)).toBe(true);
    handle({ type: 'voice:state', state: voiceState(PEER, { selfDeaf: false }) });
    expect(lastPlayback(PEER)).toBe(false);
  });

  test('my own voice state applies global deafen without muting my user id as a peer', () => {
    handle({ type: 'voice:state', state: voiceState(ME, { selfDeaf: true, selfMute: true }) });
    expect(deafened.mock.calls.at(-1)?.[0]).toBe(true);
    expect(playback.mock.calls).toHaveLength(0);

    handle({ type: 'voice:state', state: voiceState(ME, { selfDeaf: false, selfMute: true }) });
    expect(deafened.mock.calls.at(-1)?.[0]).toBe(false);
    expect(playback.mock.calls).toHaveLength(0);
  });

  test('voice sync applies my deafen and continues applying each peer mute independently', () => {
    handle({
      type: 'voice:sync',
      states: [voiceState(ME, { serverDeaf: true }), voiceState(PEER, { selfDeaf: true })],
      audience: [],
    });
    expect(deafened.mock.calls.at(-1)?.[0]).toBe(true);
    expect(playback.mock.calls.map((call: unknown[]) => call[0])).toEqual([PEER]);
    expect(lastPlayback(PEER)).toBe(true);
  });

  test('reconnecting mid-call does not drop the caller out of the call', () => {
    handle({ type: 'voice:state', state: voiceState(ME, { channelId: 'call-a' }) });
    expect(useChatStore.getState().myVoice).toEqual({ guildId: 'guild-1', channelId: 'call-a' });

    // a sync that does not list my row must not end my seat
    handle({ type: 'voice:sync', states: [voiceState(PEER, { channelId: 'call-a' })], audience: [] });
    expect(useChatStore.getState().myVoice).toEqual({ guildId: 'guild-1', channelId: 'call-a' });
    expect(useChatStore.getState().voiceStates[`guild-1:${PEER}`]).toBeDefined();
  });

  test('a sync that includes me still resolves my seat', () => {
    useChatStore.setState({ myVoice: null });
    handle({ type: 'voice:sync', states: [voiceState(ME, { channelId: 'call-b' })], audience: [] });
    expect(useChatStore.getState().myVoice).toEqual({ guildId: 'guild-1', channelId: 'call-b' });
  });

  test('a sync that does not list me still re-diffs the mesh against the new roster', () => {
    handle({ type: 'voice:state', state: voiceState(ME, { channelId: 'call-a' }) });
    reconcile.mockClear();
    // a peer left while I was offline; their row is gone from the sync
    handle({ type: 'voice:sync', states: [voiceState(PEER)], audience: [] });
    expect(reconcile.mock.calls).toHaveLength(1);
    expect(reconcile.mock.calls[0][0]).toBe('call-a');
    expect([...(reconcile.mock.calls[0][1] as string[])]).toEqual([PEER]);
  });

  test('a sync pre-mutes peers already deafened and re-diffs the mesh', () => {
    handle({
      type: 'voice:sync',
      states: [voiceState(ME), voiceState('deaf-guy', { selfDeaf: true }), voiceState(PEER)],
      audience: [],
    });
    expect(lastPlayback('deaf-guy')).toBe(true);
    expect(lastPlayback(PEER)).toBe(false);
    expect(lastReconciledPeers()).toEqual(['deaf-guy', PEER]);
  });

  test('a peer joining the call is connected to the mesh, a peer elsewhere is not', () => {
    handle({ type: 'voice:state', state: voiceState(PEER) });
    expect(lastReconciledPeers()).toEqual([PEER]);
    expect(reconcile.mock.calls[0][0]).toBe('call-a');

    reconcile.mockClear();
    handle({ type: 'voice:state', state: voiceState('elsewhere', { channelId: 'call-other' }) });
    expect(reconcile.mock.calls).toHaveLength(0);
  });

  test('a peer leaving the call drops its media right away', () => {
    handle({ type: 'voice:leave', guildId: 'guild-1', channelId: 'call-a', userId: PEER });
    expect(disconnect.mock.calls.map((call: unknown[]) => call[0])).toEqual([PEER]);
    // my own leave is handled by leaveVoice, never as a peer disconnect
    handle({ type: 'voice:leave', guildId: 'guild-1', channelId: 'call-a', userId: ME });
    expect(disconnect.mock.calls.map((call: unknown[]) => call[0])).toEqual([PEER]);
  });

  test('a member arriving through member:add is not shown offline to others', () => {
    // the server builds `member:add` from the joiner's own view, where they are not online yet
    useChatStore.getState().reset();
    useChatStore.setState({
      voiceStates: {},
      myVoice: null,
      online: { [PEER]: true },
      presence: { [PEER]: 'online' },
      guildDetails: { 'guild-1': { id: 'guild-1', members: [] } as never },
    });
    const member = { guildId: 'guild-1', role: 'member', joinedAt: 'x', online: false, roleIds: [], position: 0, user: user(PEER) };
    (useChatStore.getState().handleEvent as (event: unknown, me: string) => void)(
      { type: 'member:add', guildId: 'guild-1', member },
      ME,
    );
    expect(useChatStore.getState().online[PEER]).toBe(true);
    expect(useChatStore.getState().presence[PEER]).toBe('online');
    expect(useChatStore.getState().guildDetails['guild-1'].members[0].online).toBe(true);
  });

  test('leaving the guild clears my call seat and the stale roster', () => {
    handle({ type: 'voice:state', state: voiceState(ME) });
    handle({ type: 'voice:state', state: voiceState(PEER) });
    handle({ type: 'voice:leave', guildId: 'guild-1', channelId: 'call-a', userId: ME });
    handle({ type: 'voice:leave', guildId: 'guild-1', channelId: 'call-a', userId: PEER });
    expect(useChatStore.getState().myVoice).toBeNull();
    expect(useChatStore.getState().voiceStates).toEqual({});
  });
});
