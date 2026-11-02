import {
  LogIn,
  LogOut,
  Maximize2,
  MessageSquare,
  Minimize2,
  MonitorUp,
  ScreenShareOff,
  Settings,
  UserRound,
  Volume1,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Channel, VoiceState } from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import { useShallow } from 'zustand/react/shallow';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { useUiStore } from '../../app/stores/ui';
import { Avatar } from '../../components/ui/Avatar';
import { BannerBackdrop } from '../../components/layout/BannerBackdrop';
import { Button } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import { onScreenShare, setPlaybackVolume, startScreenShare, stopScreenShare } from '../../lib/voice-session';
import { applySink, useAudioStore } from '../../app/stores/audio';
import { openPersonMenu } from './personMenu';
import { MIC_OFF, MIC_ON, OFF_STATE, SOUND_OFF, SOUND_ON } from '../../lib/voice-indicators';
import { MessageList } from '../messages/MessageList';
import { AVATAR_FOR, layoutStage, stageCaps, type TileSize } from './voiceStageLayout';

/**
 * Voice channel page, mirroring Discord: a voice stage on the left with
 * "join"/"leave", the connected tiles and the call controls, plus a text chat
 * that belongs to this voice channel alone.
 */
export function VoiceChannelView({ guildId, channel }: { guildId: string; channel: Channel }) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const myVoice = useChatStore((state) => state.myVoice);
  const joinVoice = useChatStore((state) => state.joinVoice);
  const leaveVoice = useChatStore((state) => state.leaveVoice);
  const setSelfVoice = useChatStore((state) => state.setSelfVoice);
  const speaking = useChatStore((state) => state.speaking);
  const voiceStates = useChatStore((state) => state.voiceStates);
  const participants = useChatStore(
    useShallow((state) =>
      Object.values(state.voiceStates).filter((state) => state.guildId === guildId && state.channelId === channel.id),
    ),
  );
  const [sharing, setSharing] = useState<Record<string, boolean>>({});
  const [screens, setScreens] = useState<Record<string, MediaStreamTrack | null>>({});
  const [screenAudio, setScreenAudio] = useState<Record<string, MediaStreamTrack | null>>({});
  const [sharingLocal, setSharingLocal] = useState(false);
  const [busy, setBusy] = useState(false);

  const currentUserId = useAuthStore((state) => state.user?.id);
  const selfId = currentUserId ?? null;

  useEffect(
    () =>
      onScreenShare({
        active: (userId, active) => setSharing((current) => ({ ...current, [userId]: active })),
        track: (userId, track) => setScreens((current) => ({ ...current, [userId]: track })),
        audio: (userId, track) => setScreenAudio((current) => ({ ...current, [userId]: track })),
        local: (active, tracks) => {
          setSharingLocal(active);
          // nobody sends us our own tracks, so the preview comes straight from the capture
          if (selfId) {
            setSharing((current) => ({ ...current, [selfId]: active }));
            setScreens((current) => ({ ...current, [selfId]: tracks.video }));
            setScreenAudio((current) => ({ ...current, [selfId]: tracks.audio }));
          }
        },
      }),
    [selfId],
  );

  const mine = participants.find((state) => state.user.id === currentUserId);
  const inThisChannel = myVoice?.guildId === guildId && myVoice.channelId === channel.id;
  const canConnect = canInGuild(guild, Permission.Connect);
  const micMuted = mine?.selfMute ?? false;
  const deafened = mine?.selfDeaf ?? false;
  const anyoneSharing = Object.values(sharing).some(Boolean);

  const toggleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (sharingLocal) {
        stopScreenShare();
        return;
      }
      const { hasAudio, label, quality } = await startScreenShare();
      // report what the OS actually delivered, not what was asked for
      const actual =
        quality.width && quality.height
          ? `${quality.height}p${quality.frameRate ? ` @ ${Math.round(quality.frameRate)} fps` : ''}`
          : '';
      if (!hasAudio) {
        // Electron asks the OS for system audio itself, so there is no picker option to point at
        toast.error(
          'Compartilhando sem áudio',
          'O sistema não entregou o áudio da tela. O microfone continua na call normalmente.',
        );
      } else if (label) {
        toast.success(actual ? `Transmitindo em ${actual}` : `Transmitindo: ${label}`, actual ? label : undefined);
      }
    } catch (error) {
      // passive cases: the picker was closed, or Electron had no screen to capture
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return;
      toast.error('Falha ao compartilhar a tela', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  // leaving the call must also stop a running share
  useEffect(() => {
    if (!inThisChannel && sharingLocal) stopScreenShare();
  }, [inThisChannel, sharingLocal]);

  // A pending click is remembered so a double-click ends in the state the user last asked for
  // (join then leave), instead of firing two racing requests.
  const pendingRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef<'join' | 'leave' | null>(null);

  const toggle = async () => {
    const run = async (action: 'join' | 'leave') => {
      await (action === 'join' ? joinVoice(guildId, channel.id) : leaveVoice());
    };
    if (pendingRef.current) {
      queuedRef.current = inThisChannel ? 'leave' : 'join';
      await pendingRef.current.catch(() => undefined);
      const next = queuedRef.current;
      queuedRef.current = null;
      if (!next) return;
      const settled = useChatStore.getState().myVoice;
      const alreadyThere = !!settled && settled.guildId === guildId && settled.channelId === channel.id;
      if ((next === 'join') === alreadyThere) return;
      pendingRef.current = run(next)
        .catch((error: unknown) => {
          toast.error(next === 'join' ? 'Não foi possível entrar' : 'Não foi possível sair', error instanceof Error ? error.message : undefined);
        })
        .finally(() => {
          pendingRef.current = null;
        });
      return;
    }
    pendingRef.current = run(inThisChannel ? 'leave' : 'join')
      .catch((error: unknown) => {
        toast.error(inThisChannel ? 'Não foi possível sair' : 'Não foi possível entrar', error instanceof Error ? error.message : undefined);
      })
      .finally(() => {
        pendingRef.current = null;
      });
    await pendingRef.current;
  };

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-chat">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-4">
          <Volume2 size={20} className="shrink-0 text-muted" aria-hidden />
          <h1 className="truncate text-base font-semibold text-heading">{channel.name}</h1>
          <span className="ml-auto text-[12px] text-muted">
            {participants.length} {participants.length === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
            {participants.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="flex size-24 items-center justify-center rounded-full bg-input text-muted">
                  <Volume2 size={38} aria-hidden />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-heading">Ninguém por aqui ainda</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted">
                    Entre na chamada para conversar, ou use o chat ao lado enquanto espera.
                  </p>
                </div>
                <Button variant="primary" onClick={() => void toggle()} disabled={!canConnect && !inThisChannel}>
                  <LogIn size={16} aria-hidden /> Entrar na chamada
                </Button>
              </div>
            ) : (
              <ParticipantStage guildId={guildId} participants={participants} speaking={speaking} screens={screens} sharing={sharing} />
            )}
          </div>

          {inThisChannel || participants.length > 0 ? (
            <CallControls
              inCall={inThisChannel}
              micMuted={micMuted}
              deafened={deafened}
              screenShared={sharingLocal}
              sharingBusy={busy}
              canConnect={canConnect}
              onToggleMic={() => void setSelfVoice({ selfMute: !micMuted })}
              // deafen implies mute in the store; un-deafening keeps the mic muted until the user unmutes
              onToggleSound={() => void setSelfVoice({ selfDeaf: !deafened, selfMute: !deafened ? true : undefined })}
              onToggleCall={() => void toggle()}
              onToggleScreen={() => void toggleShare()}
            />
          ) : null}
        </div>
      </section>

      <aside className="flex w-[340px] shrink-0 flex-col border-l border-divider bg-chat" aria-label="Chat do canal de voz">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-4">
          <MessageSquare size={16} className="text-muted" aria-hidden />
          <span className="text-sm font-semibold text-heading">Chat de #{channel.name}</span>
        </header>
        <MessageList channelId={channel.id} guildId={guildId} />
      </aside>

      {/* screen audio is a separate track from the voices, so it plays in its own element */}
      {Object.entries(screenAudio).map(([userId, track]) =>
        // our own capture is already audible locally; replaying it would double the sound
        track && userId !== selfId ? <ScreenAudio key={userId} userId={userId} track={track} /> : null,
      )}
    </div>
  );
}

/** Plays a peer's shared screen audio, kept apart from call audio to avoid doubling it. */
function ScreenAudio({ userId, track }: { userId: string; track: MediaStreamTrack }) {
  const outputId = useAudioStore((state) => state.prefs.outputId);
  const volume = useAudioStore((state) => state.prefs.outputVolume);
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
    element.volume = volume;
    void applySink(element, outputId).catch(() => undefined);
  }, [outputId, volume]);

  return <audio ref={audioRef} autoPlay className="hidden" data-screen-audio={userId} />;
}

/**
 * The stage fills the whole area with packed 16:9 tiles: a screen share (or a
 * spotlighted person) gets its own large row and the rest share the remaining
 * height, while a plain call lays everyone out over the full area. Tile size is
 * always measured from the space available, never from a fixed height, so one or
 * two people don't turn into a giant slab and a crowd never shrinks to thumbnails.
 */
function ParticipantStage({
  guildId,
  participants,
  speaking,
  screens,
  sharing,
}: {
  guildId: string;
  participants: VoiceState[];
  speaking: Record<string, boolean>;
  screens: Record<string, MediaStreamTrack | null>;
  sharing: Record<string, boolean>;
}) {
  const sharers = participants.filter((state) => sharing[state.user.id] && screens[state.user.id]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // grid tiles keep the source the viewer chose per person; a shared screen is the default
  const [views, setViews] = useState<Record<string, 'screen' | 'camera'>>({});
  // full screen is only ever offered for a transmission, never for a face
  const [theaterId, setTheaterId] = useState<string | null>(null);
  const theater = theaterId ? participants.find((state) => state.user.id === theaterId) : undefined;
  useEffect(() => {
    if (theaterId && !theater) setTheaterId(null);
  }, [theaterId, theater]);

  const activeId =
    pickedId && participants.some((state) => state.user.id === pickedId)
      ? pickedId
      : (sharers[0]?.user.id ?? null);
  const focused = participants.find((state) => state.user.id === activeId) ?? null;
  const rest = participants.filter((state) => state.user.id !== activeId);
  const sourceOf = (state: VoiceState) =>
    views[state.user.id] ?? (sharing[state.user.id] && screens[state.user.id] ? ('screen' as const) : ('camera' as const));
  const broadcastFor = (state: VoiceState, viewing: 'screen' | 'camera'): StageBroadcast => ({
    viewing,
    screens,
    sharing,
    onView: sharing[state.user.id] && screens[state.user.id] ? (source) => setViews((current) => ({ ...current, [state.user.id]: source })) : undefined,
  });

  const boxRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useElementSize(boxRef);

  // someone sharing, or someone explicitly spotlighted, takes the big tile; a plain call is an equal grid
  const sizes = layoutStage({
    width,
    height,
    hasFocus: !!focused,
    restCount: focused ? rest.length : participants.length,
    spotlit: !!pickedId,
  });
  const cells = focused ? rest : participants;
  if (!sizes) {
    // first paint has no measurement yet: keep the box so the observer can report its size
    return <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 flex-col" />;
  }

  // Discord caps the stage so a lone person doesn't stretch across the window; the layout already
  // sized the tiles inside those caps, so this box only states the width it centred within
  const caps = stageCaps(width, height);
  const tileKey = (state: VoiceState) => `${state.user.id}:${sharing[state.user.id] ? 'screen' : 'face'}`;

  return (
    // the measured box is the full stage; the tiles sit in a capped, vertically centred block inside it
    <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
    <div className="flex w-full flex-col gap-2" style={{ maxWidth: caps.maxWidth, maxHeight: caps.maxHeight }}>
      {focused && sizes.focus.height > 0 ? (
        <div className="relative mx-auto shrink-0 overflow-hidden rounded-lg bg-black" style={sizes.focus}>
          <StageTile
            key={`${tileKey(focused)}-${sourceOf(focused)}`}
            state={focused}
            speaking={speaking}
            broadcast={broadcastFor(focused, sourceOf(focused))}
            size={sizes.focusSize}
            focused
            onFullscreen={() => setTheaterId(focused.user.id)}
            onOpenMenu={(at) => openPersonMenu(focused, guildId, at)}
          />
        </div>
      ) : null}

      {cells.length > 0 ? (
        <ul
          className="mx-auto grid shrink-0 content-start justify-items-stretch"
          style={{
            ...sizes.grid,
            gridTemplateColumns: `repeat(${sizes.columns}, ${sizes.gridSize.width}px)`,
            gridAutoRows: `${sizes.gridSize.height}px`,
          }}
          aria-label={focused ? 'Outras pessoas na chamada' : 'Pessoas na chamada'}
        >
          {cells.map((state) => (
            <li key={state.user.id} className="relative">
              <StageTile
                key={`${tileKey(state)}-${sourceOf(state)}`}
                state={state}
                speaking={speaking}
                broadcast={broadcastFor(state, sourceOf(state))}
                size={sizes.gridSize.avatar}
                onFullscreen={sourceOf(state) === 'screen' ? () => setTheaterId(state.user.id) : undefined}
                onOpenMenu={(at) => openPersonMenu(state, guildId, at)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    {theater && screens[theater.user.id] ? (
      <TheaterView
        state={theater}
        track={screens[theater.user.id]!}
        onClose={() => setTheaterId(null)}
      />
    ) : null}
    </div>
  );
}

/** Full-screen player for one person's shared screen, with only the essentials on top. */
function TheaterView({
  state,
  track,
  onClose,
}: {
  state: VoiceState;
  track: MediaStreamTrack;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={`Transmissão de ${state.user.displayName}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-strong px-3 text-on-image">
        <MonitorUp size={15} aria-hidden />
        <span className="truncate text-sm font-medium">{state.user.displayName}</span>
        <span className="text-xs text-on-image/60">— transmissão</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sair da tela cheia"
          className="ml-auto flex items-center gap-1.5 rounded-sm bg-white/10 px-2.5 py-1 text-xs font-semibold text-on-image transition-colors hover:bg-white/20"
        >
          <Minimize2 size={13} aria-hidden /> Sair (Esc)
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <ScreenTile track={track} />
      </div>
    </div>
  );
}

/** Tracks the pixel size of an element so the stage can size tiles from real space. */
function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

interface StageBroadcast {
  /** What this person is showing: their screen, or their own face. */
  viewing: 'screen' | 'camera';
  screens: Record<string, MediaStreamTrack | null>;
  sharing: Record<string, boolean>;
  /** Called when the viewer picks another source; absent when there is nothing to choose. */
  onView?: (source: 'screen' | 'camera') => void;
}

/**
 * One tile. In the grid a card only shows its name; the volume slider and the
 * source/fullscreen controls fade in on hover (or focus), so the cards stay
 * calm at rest. Right-clicking a card opens that person's actions instead.
 */
function StageTile({
  state,
  speaking,
  broadcast,
  size,
  focused = false,
  onFullscreen,
  onOpenMenu,
}: {
  state: VoiceState;
  speaking: Record<string, boolean>;
  broadcast: StageBroadcast;
  size: TileSize;
  focused?: boolean;
  /** Only transmissions can go full screen. */
  onFullscreen?: () => void;
  onOpenMenu?: (at: { x: number; y: number }) => void;
}) {
  const active = speaking[state.user.id] && !state.serverMute && !state.selfMute;
  const muted = state.serverMute || state.selfMute;
  const deaf = state.serverDeaf || state.selfDeaf;
  const hasScreen = broadcast.sharing[state.user.id] && !!broadcast.screens[state.user.id];
  const screen = hasScreen && broadcast.viewing === 'screen' ? broadcast.screens[state.user.id] : null;
  const initialVolume = useAudioStore((store) => store.prefs.userVolumes[state.user.id] ?? 1);
  const setPrefs = useAudioStore((store) => store.setPrefs);
  const setAppVolume = (gain: number) => {
    const { userVolumes } = useAudioStore.getState().prefs;
    setPrefs({ userVolumes: { ...userVolumes, [state.user.id]: gain } });
    setPlaybackVolume(state.user.id, gain);
  };
  const compact = focused || size === 'sm' || size === 'md' ? 'small' : 'large';
  // the spotlight shows its controls at rest; grid cards reveal them on hover/focus only
  const reveal = focused
    ? 'opacity-100'
    : 'opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100';

  return (
    <div
      onContextMenu={
        onOpenMenu
          ? (event) => {
              event.preventDefault();
              onOpenMenu({ x: event.clientX, y: event.clientY });
            }
          : undefined
      }
      className={cn(
        'group/tile absolute inset-0 flex flex-col overflow-hidden rounded-lg',
        focused ? 'border-2' : 'border border-divider',
        focused && (active ? 'border-green' : 'border-divider'),
      )}
    >
      <BannerBackdrop
        imageUrl={state.user.bannerUrl}
        color={state.user.accentColor}
        scrim="card"
      />
      {screen ? (
        <ScreenTile track={screen} />
      ) : (
        <div className={cn('relative flex flex-1 flex-col items-center justify-center gap-1.5 p-3', !focused && 'pb-9')}>
          <Avatar
            name={state.user.displayName}
            src={state.user.avatarUrl}
            color={state.user.accentColor}
            size={compact === 'small' ? 'md' : 'xl'}
          />
          <span className={cn('max-w-full truncate text-center font-medium text-heading', compact === 'small' ? 'text-xs' : 'text-base')}>
            {state.user.displayName}
          </span>
          {muted || deaf ? (
            <span className="flex items-center gap-1.5">
              {muted ? <MIC_OFF size={12} className={OFF_STATE} aria-label="Microfone desligado" /> : null}
              {deaf ? <SOUND_OFF size={12} className={OFF_STATE} aria-label="Som desativado" /> : null}
            </span>
          ) : null}
        </div>
      )}

      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-1.5 pt-6',
          reveal,
        )}
      >
        {/* plain white: the frame no longer uses `text-white`, which this theme redefines as an overlay */}
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--color-on-image)' }}>
          {screen ? <MonitorUp size={12} aria-hidden /> : null}
          <span className="truncate">{state.user.displayName}</span>
        </span>
        {((state.user.id !== useAuthStore.getState().user?.id) || (hasScreen && broadcast.onView) || onFullscreen) ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-scrim py-1 pl-2 pr-1">
          {state.user.id !== useAuthStore.getState().user?.id ? (
            <>
              <Volume1 size={12} aria-hidden className="text-on-image/75" />
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(initialVolume * 100)}
                aria-label={`Volume de ${state.user.displayName}`}
                onChange={(event) => setAppVolume(Number(event.target.value) / 100)}
                className="tile-volume h-3 w-20 cursor-pointer"
              />
            </>
          ) : null}
          {hasScreen && broadcast.onView ? (
            <TileIconButton
              icon={broadcast.viewing === 'screen' ? UserRound : MonitorUp}
              label={
                broadcast.viewing === 'screen'
                  ? `Mostrar ${state.user.displayName} em vez da transmissão`
                  : `Ver a transmissão de ${state.user.displayName}`
              }
              onClick={() => broadcast.onView?.(broadcast.viewing === 'screen' ? 'camera' : 'screen')}
            />
          ) : null}
          {onFullscreen ? (
            <TileIconButton
              icon={Maximize2}
              label={`Tela cheia: transmissão de ${state.user.displayName}`}
              onClick={onFullscreen}
            />
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
}

function TileIconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        // the tile itself is a button in the grid: this must never also focus the tile
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-on-image/85 transition-colors hover:bg-white/15 hover:text-on-image focus-visible:outline-2 focus-visible:outline-on-image"
    >
      <Icon size={13} aria-hidden />
    </button>
  );
}

function ScreenTile({ track }: { track: MediaStreamTrack }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // reattaching `srcObject` on every render restarts decoding and leaves the element black:
  // only rebuild the stream when the captured track itself changes
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = new MediaStream([track]);
    void element.play().catch(() => undefined);
    return () => {
      if (element.srcObject instanceof MediaStream) element.srcObject = null;
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="absolute inset-0 size-full bg-black object-contain"
    />
  );
}

/**
 * The call bar: leave on the left, then the mic/sound toggles. Screen sharing is
 * wired in the mesh but disabled here until it ships.
 */
function CallControls({
  inCall,
  micMuted,
  deafened,
  screenShared,
  sharingBusy,
  canConnect,
  onToggleMic,
  onToggleSound,
  onToggleCall,
  onToggleScreen,
}: {
  inCall: boolean;
  micMuted: boolean;
  deafened: boolean;
  screenShared: boolean;
  sharingBusy: boolean;
  canConnect: boolean;
  onToggleMic: () => void;
  onToggleSound: () => void;
  onToggleCall: () => void;
  onToggleScreen: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-divider px-4 py-3">
      <ControlButton
        icon={inCall ? LogOut : LogIn}
        label={inCall ? 'Sair da chamada' : 'Entrar na chamada'}
        tone={inCall ? 'danger' : 'primary'}
        disabled={!canConnect && !inCall}
        onClick={onToggleCall}
      />
      <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
      <ControlButton
        icon={micMuted ? MIC_OFF : MIC_ON}
        label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
        tone={micMuted ? 'off' : 'neutral'}
        disabled={!inCall}
        onClick={onToggleMic}
      />
      <ControlButton
        icon={deafened ? SOUND_OFF : SOUND_ON}
        label={deafened ? 'Ativar som' : 'Desativar som'}
        tone={deafened ? 'off' : 'neutral'}
        disabled={!inCall}
        onClick={onToggleSound}
      />
      <ControlButton
        icon={screenShared ? ScreenShareOff : MonitorUp}
        label={screenShared ? 'Parar transmissão' : 'Transmitir tela'}
        tone={screenShared ? 'active' : 'neutral'}
        disabled={!inCall || sharingBusy}
        onClick={onToggleScreen}
      />
      {/* same affordance as the dock: settings and the call chip stay reachable from the stage */}
      <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
      <ControlButton
        icon={Settings}
        label="Configurações de voz"
        tone="neutral"
        onClick={() => useUiStore.getState().openModal({ kind: 'user-settings', section: 'voice' })}
      />
    </div>
  );
}

/** Icon-only button: the call bar stays compact, the tooltip and aria-label carry the name. */
function ControlButton({
  icon: Icon,
  label,
  tone,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone: 'primary' | 'danger' | 'off' | 'active' | 'neutral';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={tone === 'off' || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-lg transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-outline',
        tone === 'primary' && 'bg-brand text-on-brand hover:bg-brand-hover',
        tone === 'danger' && 'bg-red/15 text-red hover:bg-red/25',
        // the same red as every read-only "off" indicator, on a quiet fill
        tone === 'off' && 'bg-red/15 text-red hover:bg-red/25',
        tone === 'active' && 'bg-brand-soft text-brand hover:bg-brand/25',
        tone === 'neutral' && 'text-on-image hover:bg-white/15',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
