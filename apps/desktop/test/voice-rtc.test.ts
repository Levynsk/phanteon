import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

/**
 * The voice mesh only depends on `getUserMedia` and `RTCPeerConnection`, so the
 * test drives a fake device set and records which track every peer received.
 */

class FakeTrack extends EventTarget {
  enabled = true;
  kind = 'audio';
  label = '';
  stopped = false;
  constructor(readonly id: string) {
    super();
  }
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(track: FakeTrack) {
    this.tracks = [track];
  }
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

const opened: FakeStream[] = [];
let nextDevice = 0;

const fakeMedia = {
  getUserMedia: async () => {
    nextDevice += 1;
    const stream = new FakeStream(new FakeTrack(`track-${nextDevice}`));
    opened.push(stream);
    return stream as unknown as MediaStream;
  },
} as unknown as Pick<MediaDevices, 'getUserMedia'>;

const replacements: string[] = [];

class FakePeerConnection extends EventTarget {
  readonly senders: { track: FakeTrack | null; replaceTrack: (track: FakeTrack) => Promise<void> }[] = [];
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  added: FakeTrack[] = [];
  removed: FakeTrack[] = [];
  addTrack(track: FakeTrack) {
    this.added.push(track);
    this.senders.push({
      track,
      replaceTrack: async (next: FakeTrack) => {
        replacements.push(`${track.id}->${next.id}`);
      },
    });
  }
  getSenders() {
    return this.senders;
  }
  removeTrack(sender: { track: FakeTrack | null }) {
    if (sender.track) this.removed.push(sender.track);
  }
  close() {}
  signalingState = 'stable';
  offers = 0;
  rollbacks = 0;
  createOffer() {
    this.offers += 1;
    return Promise.resolve({ sdp: 'offer-sdp' });
  }
  createAnswer() {
    return Promise.resolve({ sdp: 'answer-sdp' });
  }
  setLocalDescription(desc: { type: string }) {
    if (desc.type === 'rollback') this.rollbacks += 1;
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
  addIceCandidate() {
    return Promise.resolve();
  }
}

describe('VoiceRtc device switching', () => {
  beforeEach(() => {
    opened.length = 0;
    replacements.length = 0;
    nextDevice = 0;
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
    // WebAudio is unavailable in the test runtime: the class must fall back to the raw track
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    // the module reads devices lazily, so the fake must be live before any swap
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: fakeMedia, configurable: true });
    (globalThis as { Audio?: unknown }).Audio = class {
      muted = false;
      volume = 1;
      srcObject: unknown = null;
      play() {
        return Promise.resolve();
      }
      remove() {}
    };
  });

  afterEach(async () => {
    const { useAudioStore } = await import('../src/app/stores/audio');
    useAudioStore.getState().setPrefs({ inputId: 'default', outputId: 'default', outputVolume: 1, micVolume: 1 });
  });

  test('opens the microphone saved in the settings and publishes its track', async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const { useAudioStore } = await import('../src/app/stores/audio');
    useAudioStore.getState().setPrefs({ inputId: 'mic-usb' });

    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
    });

    await rtc.start();
    await rtc.connectTo('bob');

    expect(nextDevice).toBe(1);
    expect(rtc.localTracks().map((track) => (track as unknown as FakeTrack).id)).toEqual(['track-1']);
    rtc.stop();
  });

  test('swaps the track on every peer when the input device changes', async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const { useAudioStore } = await import('../src/app/stores/audio');

    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
    });
    await rtc.start();
    await rtc.connectTo('bob');

    useAudioStore.getState().setPrefs({ inputId: 'mic-headset' });
    // the store subscription swaps asynchronously
    await Bun.sleep(30);
    expect(replacements).toEqual(['track-1->track-2']);
    expect(nextDevice).toBe(2);
    expect((opened[0]!.tracks[0] as FakeTrack).stopped).toBe(true);
    expect(rtc.localTracks().map((track) => (track as unknown as FakeTrack).id)).toEqual(['track-2']);
    rtc.stop();
  });

  test('does not reopen the microphone when only the output changes', async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const { useAudioStore } = await import('../src/app/stores/audio');

    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
    });
    await rtc.start();
    useAudioStore.getState().setPrefs({ outputId: 'speakers', outputVolume: 0.4 });
    await Bun.sleep(10);

    expect(nextDevice).toBe(1);
    expect(replacements).toEqual([]);
    rtc.stop();
  });

  test('local deafen silences every remote player and restores participant mute state', async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
    });
    await rtc.start();
    await rtc.connectTo('bob');
    await rtc.connectTo('carol');
    const peers = (rtc as unknown as { peers: Map<string, { connection: FakePeerConnection }> }).peers;
    const players = (rtc as unknown as { players: Map<string, { muted: boolean }> }).players;
    const deliverAudio = (id: string) => {
      const peer = peers.get(id)!;
      const ontrack = peer.connection.ontrack as (event: { track: FakeTrack; streams: FakeStream[] }) => void;
      const track = Object.assign(new FakeTrack(`${id}-audio`), { kind: 'audio' });
      ontrack({ track, streams: [new FakeStream(track)] });
    };

    rtc.setPlaybackMuted('bob', true);
    deliverAudio('bob');
    deliverAudio('carol');
    rtc.setSelfDeafened(true);
    expect(players.get('bob')?.muted).toBe(true);
    expect(players.get('carol')?.muted).toBe(true);

    rtc.setPlaybackMuted('carol', true);
    rtc.setSelfDeafened(false);
    expect(players.get('bob')?.muted).toBe(true);
    expect(players.get('carol')?.muted).toBe(true);
    rtc.setPlaybackMuted('bob', false);
    expect(players.get('bob')?.muted).toBe(false);
    expect(players.get('carol')?.muted).toBe(true);

    rtc.setSelfDeafened(true);
    await rtc.connectTo('dave');
    const dave = peers.get('dave')!;
    const ontrack = dave.connection.ontrack as (event: { track: FakeTrack; streams: FakeStream[] }) => void;
    const track = Object.assign(new FakeTrack('dave-audio'), { kind: 'audio' });
    ontrack({ track, streams: [new FakeStream(track)] });
    expect(players.get('dave')?.muted).toBe(true);
    rtc.stop();
  });
});

describe('applySink', () => {
  const element = () => {
    const calls: string[] = [];
    return {
      calls,
      el: {
        setSinkId: async (id: string) => {
          calls.push(id);
          if (id === 'gone') throw new DOMException('No device', 'NotFoundError');
        },
      } as unknown as HTMLMediaElement,
    };
  };

  test('targets the chosen device and maps "default" to the browser empty id', async () => {
    const { applySink } = await import('../src/app/stores/audio');
    const { calls, el } = element();
    await applySink(el, 'abc');
    await applySink(el, 'default');
    expect(calls).toEqual(['abc', '']);
  });

  test('surfaces a missing device instead of silently playing on the default one', async () => {
    const { applySink } = await import('../src/app/stores/audio');
    const { el } = element();
    await expect(applySink(el, 'gone')).rejects.toThrow('Saída indisponível');
  });
});

describe('VoiceRtc screen sharing', () => {
  const signal = async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const sent: { to: string; kind: string }[] = [];
    const screens: Record<string, boolean> = {};
    const videoTracks: Record<string, unknown> = {};
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: (to, data) => sent.push({ to, kind: data.kind }),
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
      onRemoteScreen: (userId, active) => {
        screens[userId] = active;
      },
      onRemoteScreenTrack: (userId, track) => {
        videoTracks[userId] = track;
      },
    });
    await rtc.start();
    await rtc.connectTo('bob');
    const peers = (rtc as unknown as { peers: Map<string, { connection: FakePeerConnection }> }).peers;
    return { rtc, sent, screens, videoTracks, peers };
  };

  beforeEach(() => {
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    (globalThis as { Audio?: unknown }).Audio = class {
      muted = false;
      volume = 1;
      srcObject: unknown = null;
      play() {
        return Promise.resolve();
      }
      remove() {}
    };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: fakeMedia, configurable: true });
  });

  test('announces the share and adds the video track to every peer', async () => {
    const { rtc, sent, peers } = await signal();
    const video = new FakeTrack('screen-1');
    (video as unknown as { kind: string }).kind = 'video';
    const stream = { getVideoTracks: () => [video], getAudioTracks: () => [], getTracks: () => [video] } as unknown as MediaStream;

    await rtc.shareScreen(stream);

    expect(sent.filter((entry) => entry.kind === 'screen')).toEqual([{ to: 'bob', kind: 'screen' }]);
    expect(peers.get('bob')!.connection.added).toContain(video as unknown as FakeTrack);
    expect(rtc.sharingScreen()).toBe(true);
    rtc.stop();
  });

  test('keeps a screen announcement that arrives before its offer', async () => {
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const screens: Record<string, boolean> = {};
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
      onRemoteScreen: (userId, active) => { screens[userId] = active; },
    });
    await rtc.start();

    await rtc.applySignal('bob', { kind: 'screen', active: true });
    expect(screens.bob).toBeUndefined();
    await rtc.applySignal('bob', { kind: 'offer', sdp: 'offer-sdp' });

    expect(screens.bob).toBe(true);
    rtc.stop();
  });

  test('waits for a busy connection to stabilize before offering the screen track', async () => {
    const { rtc, peers } = await signal();
    const connection = peers.get('bob')!.connection;
    const before = connection.offers;
    connection.signalingState = 'have-local-offer';
    const video = Object.assign(new FakeTrack('screen-pending'), { kind: 'video' });
    const stream = { getVideoTracks: () => [video], getAudioTracks: () => [], getTracks: () => [video] } as unknown as MediaStream;

    const sharing = rtc.shareScreen(stream);
    await Bun.sleep(0);
    expect(connection.offers).toBe(before);
    connection.signalingState = 'stable';
    connection.dispatchEvent(new Event('signalingstatechange'));
    await sharing;

    expect(connection.offers).toBe(before + 1);
    expect(rtc.sharingScreen()).toBe(true);
    rtc.stop();
  });

  test('fails and stops the capture when a connection never stabilizes', async () => {
    const { rtc, peers } = await signal();
    const connection = peers.get('bob')!.connection;
    connection.signalingState = 'have-local-offer';
    const video = Object.assign(new FakeTrack('screen-timeout'), { kind: 'video' });
    const stream = { getVideoTracks: () => [video], getAudioTracks: () => [], getTracks: () => [video] } as unknown as MediaStream;

    await expect(rtc.shareScreen(stream)).rejects.toThrow('não estabilizou');

    expect(video.stopped).toBe(true);
    expect(rtc.sharingScreen()).toBe(false);
    rtc.stop();
  });

  test('stops the capture and removes the track when sharing ends', async () => {
    const { rtc, sent, peers } = await signal();
    const video = new FakeTrack('screen-2');
    (video as unknown as { kind: string }).kind = 'video';
    const stream = { getVideoTracks: () => [video], getAudioTracks: () => [], getTracks: () => [video] } as unknown as MediaStream;
    await rtc.shareScreen(stream);

    rtc.stopScreenShare();

    expect(video.stopped).toBe(true);
    expect(rtc.sharingScreen()).toBe(false);
    expect(sent.filter((entry) => entry.kind === 'screen')).toHaveLength(2);
    expect(peers.get('bob')!.connection.removed).toContain(video as unknown as FakeTrack);
    rtc.stop();
  });

  test('a remote video track never replaces the peer audio', async () => {
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: fakeMedia, configurable: true });
    const played: unknown[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      muted = false;
      volume = 1;
      srcObject: unknown = null;
      play() {
        return Promise.resolve();
      }
      remove() {}
      pause() {}
    };
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const received: { userId: string; kind: string | null }[] = [];
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
      onRemoteScreenTrack: (userId, track) => received.push({ userId, kind: track?.kind ?? null }),
    });
    await rtc.start();
    await rtc.connectTo('bob');
    const peer = (rtc as unknown as { peers: Map<string, { connection: FakePeerConnection }> }).peers.get('bob')!;
    const ontrack = peer.connection.ontrack as (event: { track: FakeTrack; streams: unknown[] }) => void;
    const players = (rtc as unknown as { players: Map<string, { srcObject: unknown }> }).players;

    ontrack({ track: Object.assign(new FakeTrack('audio-remote'), { kind: 'audio' }), streams: [new FakeStream(new FakeTrack('a'))] });
    const audioStream = players.get('bob')?.srcObject;

    ontrack({ track: Object.assign(new FakeTrack('video-remote'), { kind: 'video' }), streams: [{}] });

    // the player still holds the audio stream, and the video reached the UI callback
    expect(players.get('bob')?.srcObject).toBe(audioStream);
    expect(received).toEqual([{ userId: 'bob', kind: 'video' }]);
    rtc.stop();
  });
});

describe('VoiceRtc screen sharing with audio and renegotiation', () => {
  const boot = async (selfId: string, peerId: string) => {
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    (globalThis as { Audio?: unknown }).Audio = class {
      muted = false;
      volume = 1;
      srcObject: unknown = null;
      play() {
        return Promise.resolve();
      }
      remove() {}
    };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: fakeMedia, configurable: true });
    const { VoiceRtc, SCREEN_AUDIO_LABEL } = await import('../src/lib/voice-rtc');
    const sent: { to: string; kind: string; audio?: boolean }[] = [];
    const screenAudio: Record<string, string | null> = {};
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId,
      send: (to, data) => sent.push({ to, kind: data.kind, audio: 'audio' in data ? data.audio : undefined }),
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
      onRemoteScreenAudioTrack: (userId, track) => {
        screenAudio[userId] = track ? track.label : null;
      },
    });
    await rtc.start();
    await rtc.connectTo(peerId);
    const peer = (rtc as unknown as { peers: Map<string, { connection: FakePeerConnection }> }).peers.get(peerId)!;
    return { rtc, sent, screenAudio, peer, SCREEN_AUDIO_LABEL };
  };

  const capture = (video: FakeTrack, audio?: FakeTrack) => {
    (video as unknown as { kind: string }).kind = 'video';
    if (audio) (audio as unknown as { kind: string }).kind = 'audio';
    const all = audio ? [video, audio] : [video];
    return { getVideoTracks: () => [video], getAudioTracks: () => (audio ? [audio] : []), getTracks: () => all } as unknown as MediaStream;
  };

  test('publishes screen audio as its own marked track next to the microphone', async () => {
    const { rtc, sent, peer, SCREEN_AUDIO_LABEL } = await boot('alice', 'bob');
    const video = new FakeTrack('screen-v');
    const audio = new FakeTrack('screen-a');
    const mock = peer.connection as unknown as { added: FakeTrack[] };
    // the microphone was added when the call started; only the share is new
    const before = mock.added.length;

    await rtc.shareScreen(capture(video, audio));

    // two extra tracks arrive; the audio one is relabelled so receivers can split it
    expect(mock.added.slice(before)).toEqual([video, audio]);
    expect((audio as unknown as { displayName?: string }).displayName).toBe(SCREEN_AUDIO_LABEL);
    expect(sent.find((event) => event.kind === 'screen')?.audio).toBe(true);
    rtc.stop();
  });

  test('the higher id can add a track mid-call without glare', async () => {
    // "zoe" > "alice": the initial offer came from alice, and zoe now renegotiates
    const { rtc, peer } = await boot('zoe', 'alice');
    const before = peer.connection.offers;

    await rtc.shareScreen(capture(new FakeTrack('screen-z')));

    expect(peer.connection.offers).toBe(before + 1);
    // no rollback needed: the connection was stable when the offer was created
    expect(peer.connection.rollbacks).toBe(0);
    rtc.stop();
  });

  test('an incoming screen audio track is routed to its own listener, not to the voice player', async () => {
    const { rtc, peer, screenAudio, SCREEN_AUDIO_LABEL } = await boot('alice', 'bob');
    const ontrack = peer.connection.ontrack as (event: { track: FakeTrack; streams: unknown[] }) => void;
    const screenTrack = new FakeTrack('incoming-audio');
    (screenTrack as unknown as { kind: string }).kind = 'audio';
    (screenTrack as unknown as { label: string }).label = SCREEN_AUDIO_LABEL;

    ontrack({ track: screenTrack, streams: [] });

    expect(screenAudio.bob).toBe(SCREEN_AUDIO_LABEL);
    const players = (rtc as unknown as { players: Map<string, unknown> }).players;
    expect(players.get('bob')).toBeUndefined();
    rtc.stop();
  });
});

describe('VoiceRtc local screen preview', () => {
  test('hands the captured tracks to the sharer when the share starts and clears them on stop', async () => {
    (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    (globalThis as { Audio?: unknown }).Audio = class {
      muted = false;
      volume = 1;
      srcObject: unknown = null;
      play() {
        return Promise.resolve();
      }
      remove() {}
    };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: fakeMedia, configurable: true });
    const { VoiceRtc } = await import('../src/lib/voice-rtc');
    const events: { sharing: boolean; video: string | null; audio: string | null }[] = [];
    const rtc = new VoiceRtc({
      channelId: 'voz',
      selfId: 'alice',
      send: () => undefined,
      onLocalSpeaking: () => undefined,
      onRemoteSpeaking: () => undefined,
      onLocalScreen: (sharing, tracks) =>
        events.push({ sharing, video: tracks.video?.label ?? null, audio: tracks.audio?.id ?? null }),
    });
    await rtc.start();
    const video = new FakeTrack('screen-v');
    const audio = new FakeTrack('screen-a');
    video.kind = 'video';
    video.label = 'screen-v';
    (audio as unknown as { label: string }).label = 'screen-a';
    const stream = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [audio],
      getTracks: () => [video, audio],
    } as unknown as MediaStream;

    await rtc.shareScreen(stream);
    // snapshot right after the share: stopping afterwards must not rewrite it
    const afterStart = [...events];
    rtc.stopScreenShare();

    expect(afterStart).toEqual([{ sharing: true, video: 'screen-v', audio: 'screen-a' }]);
    expect(events.at(-1)).toEqual({ sharing: false, video: null, audio: null });
    rtc.stop();
  });
});
