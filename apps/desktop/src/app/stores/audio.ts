import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** What the settings screen and the voice session need to know about audio devices. */
export type AudioDeviceKind = 'audioinput' | 'audiooutput';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: AudioDeviceKind;
}

export type ProcessingKey = 'echoCancellation' | 'noiseSuppression' | 'autoGainControl';

export interface AudioPrefs {
  inputId: string;
  outputId: string;
  processing: Record<ProcessingKey, boolean>;
  /** Input level and the output button, used to pick and check a device on the fly. */
  micVolume: number;
  outputVolume: number;
  /** Screen share quality: the capture is constrained to this size and frame rate. */
  screenQuality: ScreenQuality;
  /** Per-person volume (0..2) chosen in the call; 1 is untouched. */
  userVolumes: Record<string, number>;
}

/** `height` is the reference axis; width follows the shared surface's aspect ratio. */
export interface ScreenQuality {
  height: number;
  frameRate: number;
}

export const SCREEN_HEIGHTS = [480, 720, 1080, 1440, 2160] as const;
export const SCREEN_FRAME_RATES = [15, 24, 30, 60] as const;

const DEFAULT_PREFS: AudioPrefs = {
  inputId: 'default',
  outputId: 'default',
  processing: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  micVolume: 1,
  outputVolume: 1,
  screenQuality: { height: 720, frameRate: 30 },
  userVolumes: {},
};

/** Placeholder shown before the browser grants permission (labels are empty until then). */
export const DEVICE_LABEL: Record<AudioDeviceKind, string> = {
  audioinput: 'Microfone',
  audiooutput: 'Alto-falante',
};

interface AudioState {
  prefs: AudioPrefs;
  devices: AudioDevice[];
  /** `prompt` until the browser grants access, which is when labels appear. */
  permission: 'unknown' | 'granted' | 'denied';
  setPrefs: (patch: Partial<AudioPrefs>) => void;
  setProcessing: (key: ProcessingKey, enabled: boolean) => void;
  setDevices: (devices: AudioDevice[]) => void;
  setPermission: (permission: AudioState['permission']) => void;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      prefs: DEFAULT_PREFS,
      devices: [],
      permission: 'unknown',
      setPrefs: (patch) => set((state) => ({ prefs: { ...state.prefs, ...patch } })),
      setProcessing: (key, enabled) =>
        set((state) => ({ prefs: { ...state.prefs, processing: { ...state.prefs.processing, [key]: enabled } } })),
      setDevices: (devices) => set({ devices }),
      setPermission: (permission) => set({ permission }),
    }),
    {
      name: 'phanteon-audio',
      // saves written before screen quality existed still carry the other prefs
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AudioState>;
        return {
          ...current,
          ...saved,
          prefs: { ...current.prefs, ...saved.prefs, screenQuality: { ...current.prefs.screenQuality, ...saved.prefs?.screenQuality } },
        };
      },
    },
  ),
);

/** `getUserMedia` constraints for the saved microphone. */
export function inputConstraints(prefs: AudioPrefs): MediaStreamConstraints {
  return {
    audio: {
      ...(prefs.inputId === 'default' ? {} : { deviceId: { exact: prefs.inputId } }),
      ...prefs.processing,
    },
  };
}

export async function listDevices(): Promise<AudioDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((device) => device.kind === 'audioinput' || device.kind === 'audiooutput')
    .map((device, index) => ({
      deviceId: device.deviceId || 'default',
      label: device.label || `${DEVICE_LABEL[device.kind as AudioDeviceKind]} ${index + 1}`,
      kind: device.kind as AudioDeviceKind,
    }));
}

/** Screen-share video constraints: the height is the reference, width follows the surface. */
export function screenVideoConstraints(quality: ScreenQuality): MediaTrackConstraints {
  return {
    height: { ideal: quality.height, max: quality.height },
    // `max` caps the share without rounding up past the chosen quality
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  };
}

/**
 * Opens a microphone matching the current preferences and returns the stream.
 * Devices that disappeared since they were saved fall back to the system default.
 */
export async function openMicrophone(prefs: AudioPrefs): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não expõe microfones.');
  try {
    return await navigator.mediaDevices.getUserMedia(inputConstraints(prefs));
  } catch (error) {
    const missing = error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError');
    if (!missing || prefs.inputId === 'default') throw error;
    return navigator.mediaDevices.getUserMedia({ audio: prefs.processing });
  }
}

export function canSelectOutput(element?: HTMLMediaElement): boolean {
  const target = element ?? (typeof HTMLMediaElement !== 'undefined' ? HTMLMediaElement.prototype : undefined);
  return !!target && 'setSinkId' in target;
}

/** Routes an element to the saved output; rejects when the device is gone or blocked. */
export async function applySink(element: HTMLMediaElement, outputId: string): Promise<void> {
  if (!canSelectOutput(element)) return;
  try {
    await (element as HTMLMediaElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(
      outputId === 'default' ? '' : outputId,
    );
  } catch (error) {
    // device unplugged or blocked by the OS: playback stays on the system default
    if (outputId !== 'default') throw new Error('Saída indisponível: escolha outro dispositivo.');
    throw error;
  }
}
