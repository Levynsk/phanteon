import { create } from 'zustand';

/**
 * Screen shares live outside the voice channel page: a call keeps running (and
 * keeps playing stream audio) while the user reads a text channel or a DM. The
 * page reads this store instead of owning the tracks, so coming back to the
 * voice channel shows the live transmissions again instead of an empty stage.
 */
interface ScreenShareState {
  /** Who is currently transmitting. Includes the local user (the preview). */
  sharing: Record<string, boolean>;
  video: Record<string, MediaStreamTrack | null>;
  audio: Record<string, MediaStreamTrack | null>;
  /** Local stream audio is transmitted unless the sharer turns it off. */
  localAudioMuted: boolean;
  setSharing: (userId: string, active: boolean) => void;
  setVideoTrack: (userId: string, track: MediaStreamTrack | null) => void;
  setAudioTrack: (userId: string, track: MediaStreamTrack | null) => void;
  setLocalAudioMuted: (muted: boolean) => void;
  reset: () => void;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useScreenShareStore = create<ScreenShareState>((set) => ({
  sharing: {},
  video: {},
  audio: {},
  localAudioMuted: false,
  setSharing: (userId, active) =>
    set((state) => ({
      sharing: { ...state.sharing, [userId]: active },
      // a stopped share must not leave a frozen frame or a dead audio element behind
      video: active ? state.video : withoutKey(state.video, userId),
      audio: active ? state.audio : withoutKey(state.audio, userId),
    })),
  setVideoTrack: (userId, track) =>
    set((state) => ({ video: track ? { ...state.video, [userId]: track } : withoutKey(state.video, userId) })),
  setAudioTrack: (userId, track) =>
    set((state) => ({ audio: track ? { ...state.audio, [userId]: track } : withoutKey(state.audio, userId) })),
  setLocalAudioMuted: (localAudioMuted) => set({ localAudioMuted }),
  reset: () => set({ sharing: {}, video: {}, audio: {} }),
}));
