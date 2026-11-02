/**
 * Notification sounds are synthesised with Web Audio instead of shipped as
 * files: small, latency-free and easy to tune. Each cue is a short bell-like
 * blip on a sine/triangle pair, wrapped in a soft envelope so nothing clicks or
 * cuts through the ears.
 */

export type SoundCue =
  | 'message'
  | 'mention'
  | 'dm'
  | 'join-call'
  | 'leave-call'
  | 'mute'
  | 'unmute'
  | 'success';

interface Tone {
  /** Frequency in Hz. */
  freq: number;
  /** Start offset in seconds, relative to the cue. */
  at: number;
  /** Length in seconds. */
  duration: number;
  /** Peak gain, 0..1 (before the master volume). */
  gain: number;
  /** Optional glide target, for the softer two-step cues. */
  glideTo?: number;
  /** Adds a quiet triangle an octave up for a tiny bit of sparkle. */
  shimmer?: boolean;
}

/**
 * Cues are two short notes at most: pleasant, recognisable, and quiet enough to
 * sit under voice audio. Frequencies sit in the "bell" register (500–1200 Hz).
 */
const CUES: Record<SoundCue, Tone[]> = {
  // soft two-note rise, for a message in a channel
  message: [
    { freq: 784, at: 0, duration: 0.16, gain: 0.16, shimmer: true },
    { freq: 1046, at: 0.085, duration: 0.2, gain: 0.13, shimmer: true },
  ],
  // brighter arpeggio for a mention or DM, clearly different from `message`
  mention: [
    { freq: 659, at: 0, duration: 0.13, gain: 0.15 },
    { freq: 880, at: 0.07, duration: 0.14, gain: 0.15 },
    { freq: 1174, at: 0.14, duration: 0.24, gain: 0.14, shimmer: true },
  ],
  dm: [
    { freq: 880, at: 0, duration: 0.12, gain: 0.13, shimmer: true },
    { freq: 1174, at: 0.075, duration: 0.18, gain: 0.12, shimmer: true },
  ],
  // warm upward glide, "you're in"
  'join-call': [{ freq: 392, at: 0, duration: 0.34, gain: 0.12, glideTo: 784 }],
  // mirror image, "you're out"
  'leave-call': [{ freq: 784, at: 0, duration: 0.34, gain: 0.11, glideTo: 392 }],
  mute: [{ freq: 440, at: 0, duration: 0.12, gain: 0.1, glideTo: 330 }],
  unmute: [{ freq: 330, at: 0, duration: 0.12, gain: 0.1, glideTo: 495 }],
  success: [
    { freq: 659, at: 0, duration: 0.12, gain: 0.11 },
    { freq: 988, at: 0.08, duration: 0.18, gain: 0.1 },
  ],
};

let context: AudioContext | null = null;

/** Browsers only start audio after a gesture, so the first play may be silent. */
function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

export function unlockAudio(): void {
  getContext();
}

/** Plays one cue. `volume` is 0..1 from the user's settings. */
export function playCue(cue: SoundCue, volume = 0.6): void {
  if (volume <= 0) return;
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(Math.max(volume, 0), 1);
  // a gentle low-pass keeps the highs soft rather than piercing
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 5200;
  master.connect(filter).connect(ctx.destination);

  for (const tone of CUES[cue]) {
    const start = now + tone.at;
    const end = start + tone.duration;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.glideTo) osc.frequency.exponentialRampToValueAtTime(tone.glideTo, end);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    // quick but not instant attack, then an exponential tail
    env.gain.exponentialRampToValueAtTime(tone.gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(end + 0.02);

    if (tone.shimmer) {
      const sparkle = ctx.createOscillator();
      sparkle.type = 'triangle';
      sparkle.frequency.setValueAtTime(tone.freq * 2, start);
      const sparkleEnv = ctx.createGain();
      sparkleEnv.gain.setValueAtTime(0.0001, start);
      sparkleEnv.gain.exponentialRampToValueAtTime(tone.gain * 0.28, start + 0.01);
      sparkleEnv.gain.exponentialRampToValueAtTime(0.0001, end);
      sparkle.connect(sparkleEnv).connect(master);
      sparkle.start(start);
      sparkle.stop(end + 0.02);
    }
  }

  setTimeout(() => master.disconnect(), 1500);
}

/** Exposed for the settings screen: a label per cue so previews read well. */
export const SOUND_LABELS: Record<SoundCue, string> = {
  message: 'Mensagem em canal',
  mention: 'Menção',
  dm: 'Mensagem direta',
  'join-call': 'Entrar na chamada',
  'leave-call': 'Sair da chamada',
  mute: 'Silenciar',
  unmute: 'Reativar microfone',
  success: 'Confirmação',
};
