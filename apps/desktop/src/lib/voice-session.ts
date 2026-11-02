import type { IceConfig, RtcSignalData, VoiceState } from '@phanteon/shared';
import { screenVideoConstraints, useAudioStore, type ScreenQuality } from '../app/stores/audio';
import { api } from './api';
import { realtime } from './realtime';
import { VoiceRtc } from './voice-rtc';

/**
 * Owns the single VoiceRtc instance for the app. The chat store calls it when
 * the local voice state changes; it keeps the mesh in sync with the roster and
 * forwards both signalling directions over the realtime socket.
 *
 * ICE comes from the server (`GET /voice/ice`), so STUN and the TURN relay are
 * configured once for every client instead of being duplicated per platform.
 */
let current: { rtc: VoiceRtc; channelId: string; selfId: string } | null = null;
let remoteSpeaking: (userId: string, speaking: boolean) => void = () => undefined;
let localSpeaking: (speaking: boolean) => void = () => undefined;
let remoteScreen: (userId: string, active: boolean) => void = () => undefined;
let remoteScreenTrack: (userId: string, track: MediaStreamTrack | null) => void = () => undefined;
let remoteScreenAudio: (userId: string, track: MediaStreamTrack | null) => void = () => undefined;
let localScreen: (sharing: boolean, tracks: ScreenTracks) => void = () => undefined;

let ice: RTCIceServer[] | undefined;
let icePromise: Promise<RTCIceServer[]> | null = null;
let signalsBound = false;

/** Fetched once per session; failure just means calls use public STUN only. */
async function loadIce(): Promise<RTCIceServer[]> {
  if (ice) return ice;
  icePromise ??= api.voice
    .ice()
    .then((config: IceConfig) => config.iceServers as RTCIceServer[])
    .catch(() => [{ urls: 'stun:stun.l.google.com:19302' }]);
  ice = await icePromise;
  return ice;
}

function bindSignals(): void {
  if (signalsBound) return;
  signalsBound = true;
  realtime.onEvent((event) => {
    if (event.type !== 'rtc:signal' || !current) return;
    if (event.channelId !== current.channelId) return;
    void current.rtc.applySignal(event.from, event.data);
  });
}

/** Starts (or keeps) the mesh for the user's call. Safe to call on every state change. */
export async function syncVoiceMesh(selfId: string, states: VoiceState[], channelId: string | null): Promise<void> {
  if (!channelId) {
    current?.rtc.stop();
    current = null;
    return;
  }
  bindSignals();

  if (current && current.channelId === channelId) {
    // roster changes: connect new peers, drop peers that left
    const present = new Set(states.filter((s) => s.channelId === channelId).map((s) => s.user.id));
    for (const userId of present) if (userId !== selfId) await current.rtc.connectTo(userId);
    return;
  }

  current?.rtc.stop();
  const rtc = new VoiceRtc({
    channelId,
    selfId,
    send: (to, data: RtcSignalData) => realtime.sendSignal(to, channelId, data),
    onLocalSpeaking: (speaking) => localSpeaking(speaking),
    onRemoteSpeaking: (userId, speaking) => remoteSpeaking(userId, speaking),
    onRemoteScreen: (userId, active) => remoteScreen(userId, active),
    onRemoteScreenTrack: (userId, track) => remoteScreenTrack(userId, track),
    onRemoteScreenAudioTrack: (userId, track) => remoteScreenAudio(userId, track),
    onLocalScreen: (sharing, tracks) => localScreen(sharing, tracks),
    iceServers: await loadIce(),
  });
  current = { rtc, channelId, selfId };
  try {
    await rtc.join(states.filter((s) => s.channelId === channelId && s.user.id !== selfId).map((s) => s.user.id));
  } catch {
    // no microphone / permission denied: still connected to the call state
  }
}

export function setSelfMuted(muted: boolean): void {
  current?.rtc.setSelfMuted(muted);
}

export function setPlaybackMuted(userId: string, muted: boolean): void {
  current?.rtc.setPlaybackMuted(userId, muted);
}

/** Re-applies a person's own volume while the call is up. */
export function setPlaybackVolume(userId: string, gain: number): void {
  current?.rtc.setPlaybackVolume(userId, gain);
}

/** Connects newly seated peers and drops the ones that left, without rebuilding the mesh. */
export async function reconcileVoiceMesh(channelId: string, peerIds: string[]): Promise<void> {
  if (!current || current.channelId !== channelId) return;
  const present = new Set(peerIds.filter((id) => id !== current!.selfId));
  for (const peerId of current.rtc.connectedPeers()) {
    if (!present.has(peerId)) current.rtc.disconnectPeer(peerId);
  }
  for (const peerId of present) await current.rtc.connectTo(peerId);
}

export function disconnectVoicePeer(userId: string): void {
  current?.rtc.disconnectPeer(userId);
}

export function stopVoiceMesh(): void {
  current?.rtc.stop();
  current = null;
}

export function onSpeakingMeters(local: (speaking: boolean) => void, remote: (userId: string, speaking: boolean) => void): void {
  localSpeaking = local;
  remoteSpeaking = remote;
}

/** Tracks captured locally, handed to the sharer so their own tile shows the preview. */
export interface ScreenTracks {
  video: MediaStreamTrack | null;
  audio: MediaStreamTrack | null;
}

export interface ScreenListeners {
  active: (userId: string, sharing: boolean) => void;
  track: (userId: string, track: MediaStreamTrack | null) => void;
  audio: (userId: string, track: MediaStreamTrack | null) => void;
  local: (sharing: boolean, tracks: ScreenTracks) => void;
}

export function onScreenShare(listeners: ScreenListeners): () => void {
  remoteScreen = listeners.active;
  remoteScreenTrack = listeners.track;
  remoteScreenAudio = listeners.audio;
  localScreen = listeners.local;
  return () => {
    remoteScreen = () => undefined;
    remoteScreenTrack = () => undefined;
    remoteScreenAudio = () => undefined;
    localScreen = () => undefined;
  };
}

/**
 * Asks for a screen plus the system audio. Chromium exposes the audio as a
 * second track of the same capture; it is published separately from the mic.
 * The quality chosen in the picker becomes the constraint for the capture.
 */
export async function startScreenShare(): Promise<{ hasAudio: boolean; label: string; quality: MediaTrackSettings }> {
  if (!current) throw new Error('Entre em uma chamada para compartilhar a tela.');
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Este sistema não permite capturar a tela.');
  const saved = useAudioStore.getState().prefs.screenQuality;
  // the bridge is optional: a preload without it only loses the dialog's defaults,
  // and sharing must keep working either way
  const bridge = window.desktop;
  await bridge?.setShareQuality?.(saved).catch(() => undefined);

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: screenVideoConstraints(saved),
    // `loopback` is what Chromium understands as "share system audio"
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } as MediaTrackConstraints,
  } as DisplayMediaStreamOptions & { audio?: MediaTrackConstraints });

  const video = stream.getVideoTracks()[0];
  // the dialog may have picked another size: honour it for this share and remember it
  const picked = await bridge?.consumeShareQuality?.().catch(() => null);
  if (picked && video) {
    await video.applyConstraints(screenVideoConstraints(picked)).catch(() => undefined);
    useAudioStore.getState().setPrefs({ screenQuality: picked });
  }

  await current.rtc.shareScreen(stream);
  return {
    hasAudio: stream.getAudioTracks().length > 0,
    label: video?.label ?? '',
    quality: video?.getSettings() ?? {},
  };
}

/**
 * Applies new quality settings to the capture that is already running, so the
 * change reaches the viewers without restarting the share. Returns the track's
 * settings as the browser actually applied them.
 */
export async function applyScreenQuality(quality: ScreenQuality): Promise<MediaTrackSettings> {
  const track = current?.rtc.screenVideoTrack();
  if (!track) throw new Error('Nenhuma tela está sendo transmitida.');
  await track.applyConstraints(screenVideoConstraints(quality));
  return track.getSettings();
}

export function stopScreenShare(): void {
  current?.rtc.stopScreenShare();
}

export function sharingScreen(): boolean {
  return !!current?.rtc.sharingScreen();
}

export function meshActive(): boolean {
  return !!current;
}
