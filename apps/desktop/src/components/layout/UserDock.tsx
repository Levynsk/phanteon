import { Bell, LogOut, Pencil, Settings, Volume2 as Volume2Icon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Permission, type UserStatus } from '@phanteon/shared';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { useUiStore } from '../../app/stores/ui';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { MIC_OFF, MIC_ON, SOUND_OFF, SOUND_ON } from '../../lib/voice-indicators';
import { VoiceCallBar } from '../../features/voice/VoiceParticipants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { MenuCheckboxItem, MenuCheckboxItemContent, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../ui/Menu';
import { STATUS_LABEL, StatusBadge, StatusDot } from '../ui/Status';
import { toast } from '../ui/Toast';

const STATUS_OPTIONS: UserStatus[] = ['online', 'idle', 'dnd', 'offline'];

/**
 * Floating identity dock over the servers/channels column: avatar, name, status,
 * mic, sound and settings in one place. Menus open upward, inside the app area.
 *
 * Everything in the dock sits on the theme's plain panel: the identity chip,
 * mic, sound and settings all share that surface, with no banner, avatar or
 * accent colour painted behind them.
 */
export function UserDock({ guildId }: { guildId?: string }) {
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);
  const socketStatus = useUiStore((state) => state.socketStatus);
  const openModal = useUiStore((state) => state.openModal);
  const online = useChatStore((state) => (user ? state.online[user.id] : false));
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const voiceStates = useChatStore((state) => state.voiceStates);
  const myVoice = useChatStore((state) => state.myVoice);
  const setSelfVoice = useChatStore((state) => state.setSelfVoice);
  const mine = user && myVoice ? voiceStates[`${myVoice.guildId}:${user.id}`] : undefined;
  const navigate = useNavigate();
  const onOpenCall = (callGuildId: string, channelId: string) => navigate(`/app/${callGuildId}/${channelId}`);
  const micMuted = mine?.selfMute ?? false;
  const deafened = mine?.selfDeaf ?? false;

  // without a call the toggles stay visual (there is nothing to transmit)
  const toggleMute = () => {
    if (mine) void setSelfVoice({ selfMute: !micMuted });
  };
  const toggleDeafen = () => {
    // deafening silences the mic as well (Discord semantics); the store enforces the same rule
    if (mine) void setSelfVoice({ selfDeaf: !deafened, selfMute: !deafened ? true : undefined });
  };

  if (!user) return null;

  const connected = socketStatus === 'open';
  const canManageGuild = canInGuild(guild, Permission.ManageGuild);

  const changeStatus = async (next: UserStatus) => {
    try {
      await updateProfile({ status: next });
    } catch (error) {
      toast.error('Não foi possível atualizar o status', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex w-[309px] flex-col justify-end">
      {/*
        Soft edge only: the solid part sits at the dock, and the fade thins out
        quickly so the list stays readable while it scrolls underneath.
      */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 -top-9 bottom-0 bg-gradient-to-t from-app-alt/95 via-app-alt/50 via-45% to-transparent" aria-hidden />
        {/* the dock's controls (mic, sound, settings) sit on a plain panel in the theme's
            own colours; only the identity chip carries the banner/accent backdrop */}
        <div className="pointer-events-auto relative mb-2 ml-2 mr-2.5 overflow-hidden rounded-xl border border-divider bg-surface-alt shadow-elevated">
          <div className="relative flex flex-col p-1.5">
            <VoiceCallBar onOpen={onOpenCall} />
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg py-0 pl-1.5 pr-2 text-left transition-colors hover:bg-hover data-[state=open]:bg-hover">
                  <span className="relative inline-flex shrink-0">
                    <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="sm" />
                    <StatusBadge status={connected ? user.status : 'offline'} ring="surface-alt" size="sm" />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[13px] font-semibold text-heading">{user.displayName}</span>
                    <span className="truncate text-[11px] text-muted">
                      {connected ? STATUS_LABEL[user.status] : 'Reconectando…'}
                    </span>
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" sideOffset={10} className="w-[232px]">
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={user.status} onValueChange={(value) => void changeStatus(value as UserStatus)}>
                    {STATUS_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option} value={option}>
                        <span className="flex items-center gap-2">
                          <StatusDot status={option} />
                          {STATUS_LABEL[option]}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <MenuItem icon={<Pencil size={13} />} onSelect={() => openModal({ kind: 'user-settings', section: 'profile' })}>
                    Editar perfil
                  </MenuItem>
                  <MenuItem variant="danger" icon={<LogOut size={13} />} onSelect={logout}>
                    Sair da conta
                  </MenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex h-10 shrink-0 items-center">
                <DockToggle
                  icon={micMuted ? MIC_OFF : MIC_ON}
                  label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
                  active={micMuted}
                  onClick={toggleMute}
                />
                <DockToggle
                  icon={deafened ? SOUND_OFF : SOUND_ON}
                  label={deafened ? 'Ativar som' : 'Desativar som'}
                  active={deafened}
                  onClick={toggleDeafen}
                />
              </div>

              <DropdownMenu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-heading data-[state=open]:bg-hover data-[state=open]:text-heading"
                  >
                    <Settings size={16} aria-hidden />
                    <span className="sr-only">Configurações</span>
                  </button>
                </MenuTrigger>
                <MenuContent side="top" align="start" sideOffset={10} className="w-[264px]">
                  <MenuLabel>Configurações</MenuLabel>
                  <MenuItem
                    icon={<Settings size={14} />}
                    onSelect={() => openModal({ kind: 'user-settings', section: 'profile' })}
                  >
                    Configurações de usuário
                  </MenuItem>
                  <MenuItem icon={<Volume2Icon size={14} />} onSelect={() => openModal({ kind: 'user-settings', section: 'voice' })}>
                    Voz e áudio
                  </MenuItem>
                  <MenuItem icon={<Bell size={14} />} onSelect={() => openModal({ kind: 'user-settings', section: 'notifications' })}>
                    Notificações
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Pencil size={14} />} onSelect={() => openModal({ kind: 'user-settings', section: 'profile' })}>
                    Editar perfil
                  </MenuItem>
                  {guildId && canManageGuild ? (
                    <MenuItem icon={<Settings size={14} />} onSelect={() => openModal({ kind: 'guild-settings', guildId })}>
                      Configurações do servidor
                    </MenuItem>
                  ) : null}
                  <MenuSeparator />
                  <MenuCheckboxItem checked={micMuted} onCheckedChange={toggleMute}>
                    <MenuCheckboxItemContent>Silenciar microfone</MenuCheckboxItemContent>
                  </MenuCheckboxItem>
                  <MenuCheckboxItem checked={deafened} onCheckedChange={toggleDeafen}>
                    <MenuCheckboxItemContent>Desativar som</MenuCheckboxItemContent>
                  </MenuCheckboxItem>
                  <MenuSeparator />
                  <MenuItem variant="danger" icon={<LogOut size={14} />} onSelect={logout}>
                    Sair da conta
                  </MenuItem>
                </MenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DockToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-hover',
        // "active" here means the control is off (muted/deafened): same red as the rest of the app
        active ? 'bg-red/15 text-red hover:bg-red/25' : 'text-muted hover:text-heading',
      )}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
