import {
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from '../../../lib/cn';
import { formatTime, progressOf, seekTarget, volumeIconLevel } from '../../../lib/video-controls';

const SEEK_STEP = 5;
const SEEK_KEY_STEP = 1;
const VOLUME_STEP = 0.05;

const VOLUME_ICON: Record<ReturnType<typeof volumeIconLevel>, LucideIcon> = {
  muted: VolumeX,
  low: Volume1,
  high: Volume2,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Inline video for a chat attachment. The native controls are replaced by a
 * bar that fades while playing and stays put on hover, focus or pause; the
 * figure takes the arrow keys and shortcuts so the player works without
 * hunting for each button.
 */
export function VideoPlayer({
  src,
  poster,
  width,
  height,
  filename,
  className,
}: {
  src: string;
  poster?: string;
  width: number | null;
  height: number | null;
  filename: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  // volume to restore when sound comes back after a mute
  const lastVolume = useRef(1);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    const syncTime = () => setCurrentTime(Number.isFinite(element.currentTime) ? element.currentTime : 0);
    const syncDuration = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const syncVolume = () => {
      setVolume(element.volume);
      setMuted(element.muted);
    };
    const onPlay = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => {
      setPlaying(false);
      setBuffering(false);
    };
    const onEnded = () => {
      setPlaying(false);
      setBuffering(false);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);

    element.addEventListener('timeupdate', syncTime);
    element.addEventListener('seeked', syncTime);
    element.addEventListener('durationchange', syncDuration);
    element.addEventListener('loadedmetadata', syncDuration);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('ended', onEnded);
    element.addEventListener('volumechange', syncVolume);
    element.addEventListener('waiting', onWaiting);
    element.addEventListener('playing', onPlaying);

    syncDuration();
    syncVolume();

    return () => {
      element.removeEventListener('timeupdate', syncTime);
      element.removeEventListener('seeked', syncTime);
      element.removeEventListener('durationchange', syncDuration);
      element.removeEventListener('loadedmetadata', syncDuration);
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('volumechange', syncVolume);
      element.removeEventListener('waiting', onWaiting);
      element.removeEventListener('playing', onPlaying);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === figureRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const setPosition = useCallback((seconds: number) => {
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  }, []);

  const applyVolume = useCallback((next: number) => {
    const element = videoRef.current;
    if (!element) return;
    const level = clamp01(next);
    element.volume = level;
    if (level > 0) lastVolume.current = level;
    if (level > 0 && element.muted) element.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.muted || element.volume === 0) {
      element.muted = false;
      element.volume = element.volume === 0 ? lastVolume.current || 1 : element.volume;
    } else {
      lastVolume.current = element.volume;
      element.muted = true;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const figure = figureRef.current;
    if (!figure) return;
    // fullscreen swallows the pointer, so the player takes focus for its shortcuts
    figure.focus();
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (figure.requestFullscreen) {
      void figure.requestFullscreen().catch(() => undefined);
      return;
    }
    const legacy = figure as HTMLElement & { webkitRequestFullscreen?: () => void };
    legacy.webkitRequestFullscreen?.();
  }, []);

  const fractionAt = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const seekToFraction = (fraction: number) => {
    if (duration <= 0) return;
    setPosition(fraction * duration);
  };

  const onTrackKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(duration, currentTime + SEEK_KEY_STEP);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, currentTime - SEEK_KEY_STEP);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (duration > 0) setPosition(next);
  };

  const onFigureKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // a focused row must still scroll (or a focused control handle its own keys)
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        event.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        setPosition(seekTarget({ duration, currentTime }, -SEEK_STEP));
        break;
      case 'ArrowRight':
        event.preventDefault();
        setPosition(seekTarget({ duration, currentTime }, SEEK_STEP));
        break;
      case 'm':
      case 'M':
        event.preventDefault();
        toggleMute();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        toggleFullscreen();
        break;
    }
  };

  const progress = progressOf(currentTime, duration);
  const ended = duration > 0 && currentTime >= duration;
  const showPlayButton = !playing && !buffering;
  const VolumeIcon = VOLUME_ICON[volumeIconLevel(volume, muted)];
  // the aspect ratio caps the inline player only: in fullscreen the size comes from the screen
  const style = !fullscreen && width && height ? ({ aspectRatio: `${width} / ${height}` } as CSSProperties) : undefined;

  return (
    <figure
      ref={figureRef}
      tabIndex={0}
      aria-label={`Vídeo: ${filename}`}
      onKeyDown={onFigureKeyDown}
      className={cn(
        'group relative mt-1 w-full max-w-[520px] overflow-hidden rounded-md bg-app outline-none focus-visible:outline-2 focus-visible:outline-brand',
        // fullscreen is a black stage with its own padding, so nothing hugs the screen edges
        fullscreen && 'flex max-w-none items-center justify-center bg-black p-4 pt-14 sm:p-6 sm:pt-16',
        className,
      )}
      style={style}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        // a box of its own lets the browser keep the video's full resolution instead of stretching one layer
        className="block size-full cursor-pointer object-contain"
        style={fullscreen ? { objectFit: 'contain', width: '100%', height: '100%' } : undefined}
        aria-label={filename}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {buffering ? (
          <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-on-image">
            <Loader2 size={28} className="animate-spin" aria-hidden />
          </span>
        ) : showPlayButton ? (
          <button
            type="button"
            aria-label="Reproduzir"
            onClick={togglePlay}
            className={cn(
              'pointer-events-auto flex items-center justify-center rounded-full bg-black/60 text-on-image shadow-scrim transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-on-image',
              fullscreen ? 'size-20' : 'size-14',
            )}
          >
            <Play size={fullscreen ? 36 : 26} fill="currentColor" aria-hidden className={ended ? undefined : 'translate-x-0.5'} />
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-1.5 pt-6 transition-opacity duration-150',
          // fullscreen keeps the bar off the screen edge and gives the touch-sized controls room
          fullscreen && 'px-4 pb-3 pt-12 sm:px-6 sm:pb-5',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          // fullscreen behaves like the system player: chrome only while hovering, so the picture is never covered
          fullscreen ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100' : playing && !buffering ? 'opacity-0' : 'opacity-100',
        )}
      >
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Progresso do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} de ${formatTime(duration)}`}
          onClick={(event) => seekToFraction(fractionAt(event.clientX))}
          onKeyDown={onTrackKeyDown}
          className="group/track flex h-3 cursor-pointer items-center rounded-xs outline-none focus-visible:outline-2 focus-visible:outline-on-image"
        >
          {/* the unfilled track stays visible over bright frames, and the thumb marks the position */}
          <span className={cn('relative w-full overflow-hidden rounded-full bg-on-image/35', fullscreen ? 'h-1.5' : 'h-1')}>
            <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
          </span>
        </div>

        <div className="flex items-center gap-1 text-on-image">
          <ControlButton
            label={playing ? 'Pausar' : 'Reproduzir'}
            icon={playing ? Pause : Play}
            onClick={togglePlay}
            large={fullscreen}
          />
          <span className={cn('ml-0.5 select-none tabular-nums text-on-image/90', fullscreen ? 'text-sm' : 'text-[11px]')}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {/* the slider is revealed by hovering the speaker, so it never crowds the bar */}
            <div className="group/volume flex items-center">
              <ControlButton
                label={muted || volume === 0 ? 'Ativar som' : 'Silenciar'}
                icon={VolumeIcon}
                onClick={toggleMute}
                large={fullscreen}
              />
              <input
                type="range"
                min={0}
                max={1}
                step={VOLUME_STEP}
                value={muted ? 0 : volume}
                aria-label="Volume"
                aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
                onChange={(event) => applyVolume(Number(event.target.value))}
                onKeyDown={(event) => event.stopPropagation()}
                className={cn(
                  'cursor-pointer accent-[var(--color-brand)] transition-[width,opacity] duration-150',
                  'opacity-0 group-hover/volume:opacity-100 group-focus-within/volume:opacity-100',
                  fullscreen ? 'h-1.5' : 'h-1',
                  // collapsed to nothing until hovered: width animates instead of the bar jumping
                  'w-0 group-hover/volume:w-16 group-focus-within/volume:w-16',
                  fullscreen && 'group-hover/volume:w-28 group-focus-within/volume:w-28',
                )}
              />
            </div>
            <ControlButton
              label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              icon={fullscreen ? Minimize2 : Maximize2}
              onClick={toggleFullscreen}
              large={fullscreen}
            />
          </div>
        </div>
      </div>

      <figcaption className="sr-only">{filename}</figcaption>
    </figure>
  );
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  large = false,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Fullscreen gets touch-sized targets instead of the compact inline ones. */
  large?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm text-on-image transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-on-image',
        large ? 'size-11' : 'size-7',
      )}
    >
      <Icon size={large ? 22 : 16} aria-hidden />
    </button>
  );
}
