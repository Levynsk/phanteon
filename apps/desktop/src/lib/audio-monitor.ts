import { create } from 'zustand';

/**
 * Live capture shared by the "test microphone" preview and the voice session, so
 * opening the settings never fights the call for the device.
 */

interface MonitorState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));

let stream: MediaStream | null = null;
let context: AudioContext | null = null;

/** Opens (once) the microphone preview; callers that only read the level share it. */
export async function acquireMonitorStream(open: () => Promise<MediaStream>): Promise<MediaStream> {
  if (stream) return stream;
  stream = await open();
  return stream;
}

/** Sample of the current RMS level in 0..1, read on demand by the meter animation. */
export async function monitorLevel(): Promise<number> {
  if (!stream) return 0;
  const ctx = (context ??= new AudioContext());
  if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  for (const node of [source, analyser]) node.disconnect();
  let sum = 0;
  for (const value of data) sum += ((value - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

export function releaseMonitorStream(): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  void context?.close();
  context = null;
}
