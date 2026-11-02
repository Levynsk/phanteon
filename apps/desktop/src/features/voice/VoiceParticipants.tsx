import { Link } from 'react-router-dom';
import { PhoneOff, ShieldAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { Avatar } from '../../components/ui/Avatar';
import { StatusBadge } from '../../components/ui/Status';
import { cn } from '../../lib/cn';
import { IconButton } from '../../components/ui/IconButton';
import { ConnectionBars } from '../../components/ui/ConnectionBars';
import { MIC_OFF, OFF_STATE, SOUND_OFF } from '../../lib/voice-indicators';
import { openPersonMenu } from './personMenu';

/** Participants of one voice channel, shown indented under the channel row. */
export function VoiceParticipants({ guildId, channelId }: { guildId: string; channelId: string }) {
  const states = useChatStore(
    useShallow((state) =>
      Object.values(state.voiceStates).filter((state) => state.guildId === guildId && state.channelId === channelId),
    ),
  );
  if (states.length === 0) return null;

  return (
    <ul className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-6" aria-label="Pessoas na chamada">
      {states.map((state) => (
        <li
          key={state.user.id}
          onContextMenu={(event) => {
            event.preventDefault();
            openPersonMenu(state, guildId, { x: event.clientX, y: event.clientY });
          }}
          className="group/voice flex items-center gap-2 rounded-sm px-2 py-[3px] text-[14px] text-normal hover:bg-hover"
        >
          <Link
            to={`/app/${guildId}/${channelId}`}
            className="relative inline-flex shrink-0"
            aria-label={state.user.displayName}
          >
            <Avatar name={state.user.displayName} src={state.user.avatarUrl} color={state.user.accentColor} size="xs" />
            <StatusBadge status="online" ring="surface" size="sm" className="size-2" />
          </Link>
          <span className={cn('min-w-0 flex-1 truncate', (state.serverMute || state.selfMute) && 'opacity-60')}>
            {state.user.displayName}
          </span>
          {state.serverMute ? (
            <ShieldAlert size={12} className={cn('shrink-0', OFF_STATE)} aria-label="Silenciado pelo servidor" />
          ) : null}
          {state.serverDeaf || state.selfDeaf ? (
            <SOUND_OFF size={12} className={cn('shrink-0', OFF_STATE)} aria-label="Som desativado" />
          ) : null}
          {state.serverMute || state.selfMute ? (
            <MIC_OFF size={12} className={cn('shrink-0', OFF_STATE)} aria-label="Microfone desligado" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Compact "connected" strip used in the dock when the user is in a call. */
export function VoiceCallBar({ onOpen }: { onOpen: (guildId: string, channelId: string) => void }) {
  const myVoice = useChatStore((state) => state.myVoice);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const mine = useChatStore((state) =>
    myVoice && currentUserId ? state.voiceStates[`${myVoice.guildId}:${currentUserId}`] : undefined,
  );
  const channel = useChatStore((state) =>
    myVoice ? state.guildDetails[myVoice.guildId]?.channels.find((item) => item.id === myVoice.channelId) : undefined,
  );
  const guild = useChatStore((state) => (myVoice ? state.guildDetails[myVoice.guildId] : undefined));
  const leaveVoice = useChatStore((state) => state.leaveVoice);
  if (!myVoice) return null;

  return (
    <div className="mb-1 flex w-full items-center gap-1 rounded-lg border border-divider bg-elevated p-1 transition-colors hover:border-line-strong">
    <button
      type="button"
      onClick={() => onOpen(myVoice.guildId, myVoice.channelId)}
      className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-hover"
      aria-label="Voltar para a chamada"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] font-semibold text-heading">Voz conectada</span>
        <span className="truncate text-[11px] text-muted">
          {guild?.name ?? 'Servidor'} / {channel?.name ?? 'canal'}
          {mine?.selfMute ? ' · mudo' : ''}
        </span>
      </span>
      {/* link quality to the server, shown only while the call is up */}
      <ConnectionBars inline muted className="pr-1" />
    </button>
    {/* same footprint and fill as the call button in the stage dock */}
    <IconButton
      icon={PhoneOff}
      size={18}
      label="Sair da chamada"
      className="size-10 rounded-lg text-red hover:bg-red/15 hover:text-red"
      onClick={() => void leaveVoice()}
    />
    </div>
  );
}
