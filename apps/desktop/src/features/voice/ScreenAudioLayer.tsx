import { useEffect, useRef } from 'react';
import { useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { useScreenShareStore } from '../../app/stores/screen';
import { useAudioStore } from '../../app/stores/audio';
import { applySink } from '../../app/stores/audio';

/**
 * Plays screen-share audio for the whole call, not only while the voice channel
 * page is open. A stream keeps running when the user opens a text channel, and
 * local deafen must silence it exactly like the voices.
 */
export function ScreenAudioLayer() {
  const tracks = useScreenShareStore((state) => state.audio);
  const selfId = useAuthStore((state) => state.user?.id);
  const myVoice = useChatStore((state) => state.myVoice);
  const mine = useChatStore((state) =>
    state.myVoice && state.selfUser ? state.voiceStates[`${state.myVoice.guildId}:${state.selfUser.id}`] : undefined,
  );
  const deafened = !!mine && (mine.selfDeaf || mine.serverDeaf);

  if (!myVoice) return null;
  return (
    <>
      {Object.entries(tracks).map(([userId, track]) =>
        // our own capture is already audible locally; replaying it would double the sound
        track && userId !== selfId ? (
          <ScreenAudioPlayer key={`${userId}:${track.id}`} userId={userId} track={track} muted={deafened} />
        ) : null,
      )}
    </>
  );
}

function ScreenAudioPlayer({
  userId,
  track,
  muted,
}: {
  userId: string;
  track: MediaStreamTrack;
  muted: boolean;
}) {
  const outputId = useAudioStore((state) => state.prefs.outputId);
  const outputVolume = useAudioStore((state) => state.prefs.outputVolume);
  const userVolume = useAudioStore((state) => state.prefs.userVolumes[userId] ?? 1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
    return () => {
      if (element.srcObject instanceof MediaStream) element.srcObject = null;
    };
  }, [track]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.muted = muted;
    // HTMLMediaElement.volume cannot exceed 1; the per-person slider still boosts up to 2x there
    element.volume = Math.min(1, Math.max(0, outputVolume * userVolume));
  }, [muted, outputVolume, userVolume]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    void applySink(element, outputId).catch(() => undefined);
  }, [outputId]);

  return <audio ref={audioRef} autoPlay className="hidden" data-screen-audio={userId} muted={muted} />;
}
