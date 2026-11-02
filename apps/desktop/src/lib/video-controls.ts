const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;

function isUsable(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Clock label for a media position: "m:ss", or "h:mm:ss" once it passes an hour. */
export function formatTime(seconds: number): string {
  if (!isUsable(seconds)) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = total % SECONDS_PER_MINUTE;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(rest)}`;
  return `${minutes}:${pad(rest)}`;
}

/**
 * Position after jumping `deltaSeconds` from `currentTime`, kept inside the
 * media. Without a usable duration there is nowhere to seek to, so the (sane)
 * current position comes back unchanged.
 */
export function seekTarget(state: { duration: number; currentTime: number }, deltaSeconds: number): number {
  const current = isUsable(state.currentTime) ? state.currentTime : 0;
  if (!isUsable(state.duration) || state.duration === 0 || !Number.isFinite(deltaSeconds)) return current;
  return Math.min(state.duration, Math.max(0, current + deltaSeconds));
}

/** Played share of the media in 0..1; 0 when the duration is unknown or invalid. */
export function progressOf(currentTime: number, duration: number): number {
  if (!isUsable(currentTime) || !isUsable(duration) || duration === 0) return 0;
  return Math.min(1, Math.max(0, currentTime / duration));
}

export function volumeIconLevel(volume: number, muted: boolean): 'muted' | 'low' | 'high' {
  if (muted) return 'muted';
  const level = isUsable(volume) ? volume : 0;
  return level < 0.5 ? 'low' : 'high';
}
