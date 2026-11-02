import type { RtcSignalData } from '@phanteon/shared';
import { applySink, openMicrophone, useAudioStore } from '../app/stores/audio';

/**
 * Full-mesh audio for one voice channel: every pair of participants owns one
 * peer connection, and signalling is relayed by the caller over the realtime
 * socket. Kept free of React and of the socket client so it stays testable.
 */

export interface VoiceRtcOptions {
  channelId: string;
  selfId: string;
  /** Sends a signal to another participant. */
  send: (to: string, data: RtcSignalData) => void;
  /** Local speaker meter (green ring in the participant tile). */
  onLocalSpeaking: (speaking: boolean) => void;
  /** Remote speaker meter, keyed by user id. */
  onRemoteSpeaking: (userId: string, speaking: boolean) => void;
  /** A peer started or stopped sharing their screen. */
  onRemoteScreen?: (userId: string, active: boolean) => void;
  /** A peer's screen video track (null once they stop sharing). */
  onRemoteScreenTrack?: (userId: string, track: MediaStreamTrack | null) => void;
  /** A peer's screen audio track, kept apart from their microphone. */
  onRemoteScreenAudioTrack?: (userId: string, track: MediaStreamTrack | null) => void;
  /**
   * This client started or stopped sharing. The captured tracks come along so
   * the sharer sees their own preview: remote peers only get them via `ontrack`.
   */
  onLocalScreen?: (sharing: boolean, tracks: { video: MediaStreamTrack | null; audio: MediaStreamTrack | null }) => void;
  /** Replaces the default ICE servers (tests pass an empty list). */
  iceServers?: RTCIceServer[];
}

/** Label given to the screen-audio track so it can be told apart from the microphone. */
export const SCREEN_AUDIO_LABEL = 'phanteon-screen-audio';
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const SPEAKING_THRESHOLD = 0.02;
const METER_INTERVAL_MS = 180;
/** How long an offer waits for the previous negotiation to settle before giving up on it. */
const NEGOTIATION_TIMEOUT_MS = 4000;

/**
 * System audio has no label of its own, so mark the screen-audio capture with a
 * display name: it survives into the remote track's label, which is how the
 * receiver tells it apart from the microphone.
 */
/**
 * Marks a captured screen-audio track as such: the display name survives into
 * the remote track's label, which is how the receiver tells it apart from voice.
 */
export function markScreenAudio(track: MediaStreamTrack): MediaStreamTrack {
  try {
    (track as MediaStreamTrack & { displayName?: string }).displayName = SCREEN_AUDIO_LABEL;
  } catch {
    // best effort: without it the track shows up as voice audio
  }
  return track;
}

/** The capture keeps its own label ("System audio"); the marker lives in `displayName`. */
export function isScreenAudioTrack(track: MediaStreamTrack | null | undefined): boolean {
  if (!track) return false;
  return (track as MediaStreamTrack & { displayName?: string }).displayName === SCREEN_AUDIO_LABEL;
}

interface Peer {
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  speaking: boolean;
  /** ICE candidates that arrived before the remote description. */
  pending: RTCIceCandidateInit[];
  /** `mid` the sharer announced for their screen audio, once known. */
  screenAudioMid: string | null;
  /** A listener is already waiting for the mid to be assigned. */
  watchMid?: boolean;
}

/** HTMLAudioElement.volume only accepts 0..1, so boosted voices are clamped there. */
function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class VoiceRtc {
  private readonly peers = new Map<string, Peer>();
  /** Audio elements that actually play remote tracks. */
  private readonly players = new Map<string, HTMLAudioElement>();
  private readonly forcedMute = new Map<string, boolean>();
  /** Remote audio elements are metered through their own analyser, created lazily. */
  private readonly remoteAnalysers = new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>();
  private localStream: MediaStream | null = null;
  /** Capture of the screen currently being shared, if any. */
  private screenStream: MediaStream | null = null;
  private screenHasAudio = false;
  private readonly remoteScreen = new Map<string, boolean>();
  /** Remote screen-audio tracks kept out of the voice player. */
  private readonly screenAudioTracks = new Map<string, MediaStreamTrack>();
  /** Raw capture; `localStream` is what the peers actually receive (after the input gain). */
  private rawStream: MediaStream | null = null;
  private gain: GainNode | null = null;
  private audioContext: AudioContext | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly unsubscribeAudio: () => void;

  constructor(private readonly options: VoiceRtcOptions) {
    this.unsubscribeAudio = useAudioStore.subscribe((state, previous) => {
      if (state.prefs.outputId !== previous.prefs.outputId) this.applyOutputDevice();
      if (state.prefs.outputVolume !== previous.prefs.outputVolume || state.prefs.userVolumes !== previous.prefs.userVolumes) {
        this.applyOutputVolume();
      }
      if (state.prefs.micVolume !== previous.prefs.micVolume) this.applyInputVolume();
      if (this.localStream && needsNewTrack(state.prefs, previous.prefs)) void this.swapInput();
    });
  }

  /** Requests the microphone chosen in the settings and starts metering the local track. */
  async start(): Promise<MediaStream> {
    if (!this.localStream) {
      const prefs = useAudioStore.getState().prefs;
      this.rawStream = await openMicrophone(prefs).catch(async () => {
        // saved device is gone: fall back to the system default
        if (prefs.inputId === 'default') throw new Error('Nenhum microfone disponível.');
        return openMicrophone({ ...prefs, inputId: 'default' });
      });
      this.watchCapture(this.rawStream);
      this.localStream = this.routeInput(this.rawStream);
    }
    this.startMeter();
    return this.localStream;
  }

  /**
   * A microphone that disappears mid-call (unplugged headset) must not leave a
   * silent peer connection: fall back to the system default once.
   */
  private watchCapture(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (this.closed) return;
        if (useAudioStore.getState().prefs.inputId === 'default') return;
        useAudioStore.getState().setPrefs({ inputId: 'default' });
      };
    }
  }

  /**
   * Sends the raw capture through a gain node so the input volume applies to
   * what peers hear. Falls back to the raw track when WebAudio is unavailable.
   */
  private routeInput(raw: MediaStream): MediaStream {
    try {
      const context = (this.audioContext ??= new AudioContext());
      const source = context.createMediaStreamSource(raw);
      const gain = context.createGain();
      gain.gain.value = useAudioStore.getState().prefs.micVolume;
      const destination = context.createMediaStreamDestination();
      source.connect(gain);
      gain.connect(destination);
      // the previous input's gain node belongs to the same context: drop it
      this.gain?.disconnect();
      this.gain = gain;
      return new MediaStream([destination.stream.getAudioTracks()[0]!]);
    } catch {
      return raw;
    }
  }

  private applyInputVolume(): void {
    if (this.gain) this.gain.gain.value = useAudioStore.getState().prefs.micVolume;
  }

  localTracks(): MediaStreamTrack[] {
    return this.localStream?.getAudioTracks() ?? [];
  }

  /**
   * Starts sending the screen to every peer. Adding a track renegotiates, so the
   * side that owns the offer (lower id) sends a fresh one after announcing.
   */
  /**
   * Shares a screen: the video track and, when the capture carries it, the
   * screen audio as its own track. Microphone audio keeps its own sender, so the
   * two never mix and the call audio cannot echo back into the share.
   */
  async shareScreen(stream: MediaStream): Promise<void> {
    const video = stream.getVideoTracks()[0];
    if (!video) return;
    // replacing a running share must not notify a stop first: peers would tear down video
    this.releaseScreenTracks(false);
    this.screenStream = stream;
    this.screenHasAudio = stream.getAudioTracks().length > 0;
    // stopping from the OS picker ends the share for everyone
    video.onended = () => this.stopScreenShare();

    for (const [userId, peer] of this.peers) {
      for (const track of stream.getTracks()) {
        peer.connection.addTrack(track.kind === 'audio' ? markScreenAudio(track) : track, stream);
      }
      this.options.send(userId, { kind: 'screen', active: true, audio: this.screenHasAudio });
      await this.renegotiate(userId, peer);
      this.announceScreenAudio(userId, peer);
      this.watchScreenAudioMid(userId, peer);
    }
    this.options.onLocalScreen?.(true, { video, audio: stream.getAudioTracks()[0] ?? null });
  }

  /**
   * The mid only exists once the offer created the transceiver, and it is the one
   * thing the receiver can rely on: Chromium renames every remote audio track to
   * "remote audio", so the label trick cannot tell screen audio from the mic.
   */
  private announceScreenAudio(userId: string, peer: Peer): void {
    if (!this.screenHasAudio) return;
    const mid = this.screenAudioMidOf(peer);
    if (!mid || mid === peer.screenAudioMid) return;
    peer.screenAudioMid = mid;
    this.options.send(userId, { kind: 'screen', active: true, audio: true, audioMid: mid });
  }

  /**
   * `setLocalDescription` assigns the mid; when the offer is created before the
   * screen was added it only appears after the next negotiation settles.
   */
  private watchScreenAudioMid(userId: string, peer: Peer): void {
    if (!this.screenHasAudio || peer.screenAudioMid || peer.watchMid) return;
    const { connection } = peer;
    if (typeof connection.addEventListener !== 'function') return;
    peer.watchMid = true;
    const check = () => {
      this.announceScreenAudio(userId, peer);
      if (peer.screenAudioMid || this.closed) {
        connection.removeEventListener('signalingstatechange', check);
        peer.watchMid = false;
      }
    };
    connection.addEventListener('signalingstatechange', check);
    setTimeout(() => {
      connection.removeEventListener('signalingstatechange', check);
      peer.watchMid = false;
    }, 10000);
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;
    this.releaseScreenTracks(true);
  }

  /** Drops the capture; `notify` tells the peers and the local preview about it. */
  private releaseScreenTracks(notify: boolean): void {
    const stream = this.screenStream;
    if (!stream) return;
    this.screenStream = null;
    this.screenHasAudio = false;
    for (const track of stream.getTracks()) track.stop();
    for (const [userId, peer] of this.peers) {
      this.options.send(userId, { kind: 'screen', active: false });
      for (const sender of peer.connection.getSenders()) {
        if (sender.track?.kind === 'video' || isScreenAudioTrack(sender.track)) {
          void peer.connection.removeTrack(sender);
        }
      }
      void this.renegotiate(userId, peer);
    }
    if (notify) this.options.onLocalScreen?.(false, { video: null, audio: null });
  }

  sharingScreen(): boolean {
    return !!this.screenStream;
  }

  /** The capture being shared, so its constraints can change without restarting. */
  screenVideoTrack(): MediaStreamTrack | null {
    return this.screenStream?.getVideoTracks()[0] ?? null;
  }

  /**
   * Renegotiation can start from either side now that anyone may add a screen.
   * Adding tracks must never be dropped because another negotiation was in
   * flight: the offer waits for the connection to settle and then goes out, which
   * is what makes the screen tracks actually reach the peers.
   */
  private async renegotiate(userId: string, peer: Peer): Promise<void> {
    await this.whenStable(peer.connection);
    if (this.closed || peer.connection.signalingState !== 'stable') return;
    await this.makeOffer(userId, peer);
  }

  /** Resolves once the connection leaves `have-local-offer`/`have-remote-offer`. */
  private whenStable(connection: RTCPeerConnection): Promise<void> {
    if (connection.signalingState === 'stable' || connection.signalingState === 'closed') return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (connection.signalingState === 'stable' || connection.signalingState === 'closed') {
          connection.removeEventListener('signalingstatechange', check);
          resolve();
        }
      };
      connection.addEventListener('signalingstatechange', check);
      // a peer that never answers must not hang the share forever
      setTimeout(() => {
        connection.removeEventListener('signalingstatechange', check);
        resolve();
      }, NEGOTIATION_TIMEOUT_MS);
    });
  }

  private clearRemoteVideo(userId: string): void {
    this.options.onRemoteScreenTrack?.(userId, null);
    this.options.onRemoteScreenAudioTrack?.(userId, null);
  }

  /** Swaps the microphone on every peer without renegotiating the connection. */
  private async swapInput(): Promise<void> {
    // devices can disappear while a selected one is being opened; never let that
    // leave the call without a microphone
    const opened = await openMicrophone(useAudioStore.getState().prefs)
      .catch(() => openMicrophone({ ...useAudioStore.getState().prefs, inputId: 'default' }))
      .catch(() => null);
    if (!opened || this.closed) {
      for (const t of opened?.getTracks() ?? []) t.stop();
      return;
    }
    const previous = this.localStream;
    const previousRaw = this.rawStream;
    this.rawStream = opened;
    this.watchCapture(opened);
    const routed = this.routeInput(opened);
    const next = routed.getAudioTracks()[0];
    if (!next) {
      for (const t of opened.getTracks()) t.stop();
      return;
    }
    // keep the control states the session already applied (self mute)
    next.enabled = previous?.getAudioTracks()[0]?.enabled ?? true;
    // another change arrived while we were opening the device: let that one win
    if (this.rawStream !== opened) {
      for (const t of [...opened.getTracks(), ...routed.getTracks()]) t.stop();
      return;
    }
    for (const peer of this.peers.values()) {
      const sender = peer.connection.getSenders().find((entry) => entry.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(next).catch(() => undefined);
    }
    for (const stream of [previous, previousRaw]) {
      for (const t of stream?.getTracks() ?? []) t.stop();
    }
    this.localStream = routed;
    // the meter analysed the old stream
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.startMeter();
  }

  private applyOutputDevice(): void {
    const { outputId } = useAudioStore.getState().prefs;
    for (const player of this.players.values()) void this.routePlayer(player, outputId);
  }

  /** Keeps the call audible when the chosen device vanished: it falls back to the system default. */
  private async routePlayer(player: HTMLAudioElement, outputId: string): Promise<void> {
    try {
      await applySink(player, outputId);
    } catch {
      await applySink(player, 'default').catch(() => undefined);
    }
  }

  private applyOutputVolume(): void {
    const { outputVolume, userVolumes } = useAudioStore.getState().prefs;
    for (const [userId, player] of this.players) {
      player.volume = clampVolume(outputVolume * (userVolumes[userId] ?? 1));
      void player.play().catch(() => undefined);
    }
  }

  /** Connects to everyone already in the channel and keeps listening to `onTrack` callbacks. */
  async join(otherUserIds: string[]): Promise<void> {
    await this.start();
    for (const userId of otherUserIds) await this.connectTo(userId);
  }

  async connectTo(userId: string): Promise<void> {
    if (this.closed || userId === this.options.selfId || this.peers.has(userId)) return;
    const peer = this.createPeer(userId);
    // deterministic roles: only the lower id offers, which avoids glare
    if (this.isOfferer(userId)) await this.makeOffer(userId, peer);
  }

  async applySignal(from: string, data: RtcSignalData): Promise<void> {
    if (this.closed || from === this.options.selfId) return;
    if (data.kind === 'screen') {
      const peer = this.peers.get(from);
      if (!peer) return;
      this.remoteScreen.set(from, data.active);
      if (typeof data.audioMid === 'string') peer.screenAudioMid = data.audioMid;
      this.options.onRemoteScreen?.(from, data.active);
      if (!data.active) this.clearRemoteVideo(from);
      else this.promoteScreenAudio(from, peer);
      return;
    }
    if (data.kind === 'offer') {
      await this.receiveOffer(from, data.sdp);
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (data.kind === 'answer') {
      await peer.connection.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this.drainCandidates(from, peer);
      return;
    }
    await this.addRemoteCandidate(from, data.candidate as RTCIceCandidateInit);
  }

  private isOfferer(userId: string): boolean {
    return this.options.selfId < userId;
  }

  private async makeOffer(userId: string, peer: Peer): Promise<void> {
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    // the accepted description carries every transceiver added since the last
    // negotiation (screen audio and video), unlike the pre-negotiation object
    const sdp = peer.connection.localDescription?.sdp ?? offer.sdp ?? '';
    this.options.send(userId, { kind: 'offer', sdp });
  }

  /**
   * Perfect negotiation: if both sides send an offer at once, the one that is not
   * allowed to offer rolls back and answers instead, so adding a screen track
   * mid-call never deadlocks.
   */
  private async receiveOffer(from: string, sdp: string): Promise<void> {
    const peer = this.peers.get(from) ?? this.createPeer(from);
    const { connection } = peer;
    const collision = connection.signalingState !== 'stable';
    if (collision) {
      if (this.isOfferer(from)) return; // our offer wins; their retry will answer it
      await connection.setLocalDescription({ type: 'rollback' });
    }
    await connection.setRemoteDescription({ type: 'offer', sdp });
    await this.drainCandidates(from, peer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    this.options.send(from, { kind: 'answer', sdp: answer.sdp ?? '' });
    // answering a sharer's offer creates the receiving side of the screen audio
    this.announceScreenAudio(from, peer);
  }

  /** Candidates can arrive before the description; keep them until it does. */
  private async addRemoteCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
    if (!peer.connection.remoteDescription) {
      peer.pending.push(candidate);
      return;
    }
    try {
      await peer.connection.addIceCandidate(candidate);
    } catch {
      // stale candidate after a renegotiation: safe to drop
    }
  }

  private async drainCandidates(from: string, peer: Peer): Promise<void> {
    if (peer.pending.length === 0) return;
    const queued = peer.pending.splice(0);
    for (const candidate of queued) await this.addRemoteCandidate(from, candidate);
  }

  /** Mutes the outgoing track: peers simply stop receiving audio. */
  setSelfMuted(muted: boolean): void {
    for (const track of this.localTracks()) track.enabled = !muted;
  }

  /** Local/remote mute applied to playback (self deafen, server mute, blocked users). */
  setPlaybackMuted(userId: string, muted: boolean): void {
    this.forcedMute.set(userId, muted);
    const player = this.players.get(userId);
    if (player) player.muted = muted;
  }

  /** Per-person loudness on top of the global output volume (0..2). */
  setPlaybackVolume(userId: string, gain: number): void {
    const player = this.players.get(userId);
    if (player) player.volume = clampVolume(useAudioStore.getState().prefs.outputVolume * gain);
  }

  connectedPeers(): string[] {
    return [...this.peers.keys()];
  }

  disconnectPeer(userId: string): void {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.close();
    this.peers.delete(userId);
    this.players.get(userId)?.remove();
    this.players.delete(userId);
    this.setRemoteSpeaking(userId, false);
  }

  stop(): void {
    this.closed = true;
    this.unsubscribeAudio();
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    for (const track of this.screenStream?.getTracks() ?? []) track.stop();
    this.screenStream = null;
    this.remoteScreen.clear();
    for (const userId of [...this.peers.keys()]) this.disconnectPeer(userId);
    for (const stream of [this.localStream, this.rawStream]) {
      for (const track of stream?.getTracks() ?? []) track.stop();
    }
    this.localStream = null;
    this.rawStream = null;
    this.gain?.disconnect();
    this.gain = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private createPeer(userId: string): Peer {
    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers ?? DEFAULT_ICE });
    const peer: Peer = { connection, stream: null, speaking: false, pending: [], screenAudioMid: null };
    this.peers.set(userId, peer);

    const stream = this.localStream;
    if (stream) for (const track of stream.getAudioTracks()) connection.addTrack(track, stream);

    connection.onicecandidate = (event) => {
      if (event.candidate) this.options.send(userId, { kind: 'candidate', candidate: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      // a shared screen arrives as extra tracks; it never replaces the peer's voice
      if (event.track.kind === 'video') {
        this.options.onRemoteScreenTrack?.(userId, event.track);
        return;
      }
      if (event.track.kind === 'audio' && this.isScreenAudio(peer, event)) {
        // keep it out of the voice player regardless of when the mid arrives
        event.track.enabled = true;
        this.screenAudioTracks.set(event.track.id, event.track);
        this.options.onRemoteScreenAudioTrack?.(userId, event.track);
        return;
      }
      const remote = event.streams[0] ?? new MediaStream([event.track]);
      peer.stream = remote;
      this.playRemote(userId, remote);
    };
    return peer;
  }

  /**
   * The announcement can arrive after the track was already routed to the voice
   * player: move it to the screen-audio channel so muting the mic never kills it.
   */
  private promoteScreenAudio(userId: string, peer: Peer): void {
    const mid = peer.screenAudioMid;
    if (!mid) return;
    const transceiver = peer.connection.getTransceivers?.().find((entry) => entry.mid === mid);
    const track = transceiver?.receiver.track;
    if (!track || track.kind !== 'audio' || this.screenAudioTracks.has(track.id)) return;
    this.screenAudioTracks.set(track.id, track);
    // the stream holding it also carries the microphone: drop only that track
    const voice = peer.stream?.getAudioTracks().filter((entry) => entry !== track) ?? [];
    if (peer.stream) {
      peer.stream.removeTrack(track);
      if (voice.length > 0) this.playRemote(userId, new MediaStream(voice));
      else {
        this.players.get(userId)?.remove();
        this.players.delete(userId);
        peer.stream = null;
      }
    }
    this.options.onRemoteScreenAudioTrack?.(userId, track);
  }

  private isScreenAudio(peer: Peer, event: RTCTrackEvent): boolean {
    // the label is the local marker when the track is created, but Chromium renames
    // the remote side to "remote audio"; the announced mid is what actually survives
    if (event.track.label === SCREEN_AUDIO_LABEL) return true;
    const mid = event.transceiver?.mid;
    return !!mid && peer.screenAudioMid !== null && mid === peer.screenAudioMid;
  }

  /** `mid` of the local sender that carries the current screen audio, once negotiated. */
  private screenAudioMidOf(peer: Peer): string | null {
    const transceivers = peer.connection.getTransceivers?.() ?? [];
    const sender = transceivers.find((transceiver) => isScreenAudioTrack(transceiver.sender?.track))?.sender;
    return sender?.track ? (transceivers.find((transceiver) => transceiver.sender === sender)?.mid ?? null) : null;
  }

  private playRemote(userId: string, stream: MediaStream): void {
    let player = this.players.get(userId);
    if (!player) {
      player = new Audio();
      player.autoplay = true;
      this.players.set(userId, player);
      const { outputId } = useAudioStore.getState().prefs;
      void this.routePlayer(player, outputId);
    }
    player.srcObject = stream;
    player.muted = this.forcedMute.get(userId) ?? false;
    const { outputVolume, userVolumes } = useAudioStore.getState().prefs;
    player.volume = clampVolume(outputVolume * (userVolumes[userId] ?? 1));
    player.play().catch(() => undefined);
  }

  private startMeter(): void {
    const meterStream = this.rawStream ?? this.localStream;
    if (this.meter || !meterStream) return;
    // the meter is cosmetic: without WebAudio the call still connects, just without the ring
    let analyser: AnalyserNode;
    try {
      // reuse the routing context so the session never runs two audio clocks
      const context = (this.audioContext ??= new AudioContext());
      const source = context.createMediaStreamSource(meterStream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    } catch {
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let last = false;

    this.meter = setInterval(() => {
      if (this.closed) return;
      const speaking = this.level(analyser, data);
      if (speaking !== last) {
        last = speaking;
        this.options.onLocalSpeaking(speaking);
      }
      for (const [userId, peer] of this.peers) {
        if (!peer.stream) continue;
        const remote = this.remoteSpeaking(userId);
        if (remote !== peer.speaking) {
          peer.speaking = remote;
          this.setRemoteSpeaking(userId, remote);
        }
      }
    }, METER_INTERVAL_MS);
  }

  private remoteSpeaking(userId: string): boolean {
    const stream = this.peers.get(userId)?.stream;
    const player = this.players.get(userId);
    if (!stream || !player || player.muted || !this.audioContext) return false;
    let entry = this.remoteAnalysers.get(userId);
    if (!entry) {
      try {
        const source = this.audioContext.createMediaStreamSource(stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        entry = { analyser, data: new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer> };
        this.remoteAnalysers.set(userId, entry);
      } catch {
        return false;
      }
    }
    return this.level(entry.analyser, entry.data);
  }

  private level(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): boolean {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += ((value - 128) / 128) ** 2;
    return Math.sqrt(sum / data.length) > SPEAKING_THRESHOLD;
  }

  private setRemoteSpeaking(userId: string, speaking: boolean): void {
    this.options.onRemoteSpeaking(userId, speaking);
    if (!speaking) this.remoteAnalysers.delete(userId);
  }
}

/** True when the saved device/processing differs in a way that needs a new capture track. */
function needsNewTrack(
  next: { inputId: string; processing: Record<string, boolean> },
  previous: { inputId: string; processing: Record<string, boolean> },
): boolean {
  if (next.inputId !== previous.inputId) return true;
  return (Object.keys(next.processing) as (keyof typeof next.processing)[]).some(
    (key) => next.processing[key] !== previous.processing[key],
  );
}
