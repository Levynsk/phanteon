import { api, currentToken } from '../../lib/api';
import { useAuthStore } from '../../app/stores/auth';
import { CheckCheck, Compass, Copy, Link2, LogOut, MessageCircle, Plus, Settings } from 'lucide-react';
import { Permission, type GuildSummary, type GuildWithDetails } from '@phanteon/shared';
import { useNotificationStore } from '../../app/stores/notifications';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu';
import { toast } from '../../components/ui/Toast';

/** Owners always manage; anyone else needs at least one of the management flags. */
function canManage(guild: GuildWithDetails | undefined): boolean {
  if (!guild) return false;
  if (guild.isOwner) return true;
  const needed = [
    Permission.ManageGuild,
    Permission.ManageChannels,
    Permission.ManageRoles,
    Permission.ManageMembers,
    Permission.BanMembers,
  ];
  return needed.some((flag) => (guild.myPermissions & flag) === flag);
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.success('ID copiado');
  } catch {
    toast.error('Não foi possível copiar');
  }
}
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { initials } from '../../components/ui/Avatar';
import { Tooltip } from '../../components/ui/Tooltip';
import { cn } from '../../lib/cn';
import { assetUrl } from '../../lib/asset-url';
import { inkOn } from '../../lib/format';

export function ServerRail() {
  const { guildId } = useParams();
  const isDmView = !guildId || guildId === 'dm';
  const guilds = useChatStore(useShallow((state) => state.guilds));
  const details = useChatStore(useShallow((state) => state.guildDetails));
  const openModal = useUiStore((state) => state.openModal);
  const markChannelRead = useNotificationStore((state) => state.markChannelRead);
  const removeGuild = useChatStore((state) => state.removeGuild);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const navigate = useNavigate();

  // the same confirm as the guild header: owners delete, everyone else actually leaves
  const confirmLeave = (guild: GuildSummary) => {
    const isOwner = !!currentUserId && guild.ownerId === currentUserId;
    openModal({
      kind: 'confirm',
      title: isOwner ? 'Excluir servidor' : 'Sair do servidor',
      description: isOwner
        ? `Tem certeza que deseja excluir "${guild.name}"? Essa ação é permanente.`
        : `Deseja sair de "${guild.name}"? Você só poderá voltar com um novo convite.`,
      confirmLabel: isOwner ? 'Excluir servidor' : 'Sair do servidor',
      onConfirm: async () => {
        if (isOwner) await api.guilds.remove(guild.id);
        else await api.guilds.leave(guild.id);
        removeGuild(guild.id);
        toast.success(isOwner ? 'Servidor excluído' : 'Você saiu do servidor');
        navigate('/app');
      },
    });
  };

  return (
    <nav
      aria-label="Servidores"
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden border-r border-divider bg-app py-3"
    >
      <Tooltip content="Mensagens diretas">
        <Link
          to="/app"
          aria-label="Mensagens diretas"
          aria-current={isDmView ? 'page' : undefined}
          className={cn(
            'flex size-12 items-center justify-center rounded-[16px] text-normal transition-all duration-200 hover:rounded-[14px]',
            isDmView
              ? 'bg-brand text-on-brand hover:bg-brand'
              : 'border border-divider bg-app hover:border-brand/40 hover:text-brand',
          )}
        >
          <MessageCircle size={22} aria-hidden />
        </Link>
      </Tooltip>

      <div className="my-1 h-px w-8 bg-divider" />

      <ul className="flex w-full flex-col items-center gap-2">
        {guilds.map((guild) => {
          const active = guildId === guild.id;
          const full = details[guild.id];
          return (
            <li key={guild.id} className="relative flex w-full justify-center">
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 w-1 rounded-r-full bg-heading transition-all duration-200',
                  active ? 'h-10 opacity-100' : 'h-2 opacity-0',
                )}
              />
              <Tooltip content={guild.name}>
                <ContextMenu>
                <ContextMenuTrigger asChild>
                <Link
                  to={`/app/${guild.id}`}
                  aria-label={guild.name}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex size-12 items-center justify-center overflow-hidden text-base font-semibold transition-all duration-200 hover:rounded-[14px]',
                    active ? 'rounded-[14px]' : 'rounded-[24px]',
                  )}
                  style={{ backgroundColor: guild.iconColor, color: inkOn(guild.iconColor) }}
                >
                  {guild.iconUrl ? (
                    <img src={assetUrl(guild.iconUrl, { token: currentToken() })} alt="" className="size-full object-cover" />
                  ) : (
                    initials(guild.name)
                  )}
                </Link>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-[228px]">
                  {canInGuild(full, Permission.CreateInvite) ? (
                    <ContextMenuItem icon={<Link2 size={14} />} onSelect={() => openModal({ kind: 'invite', guildId: guild.id })}>
                      Convidar pessoas
                    </ContextMenuItem>
                  ) : null}
                  {canManage(full) ? (
                    <ContextMenuItem icon={<Settings size={14} />} onSelect={() => openModal({ kind: 'guild-settings', guildId: guild.id })}>
                      Configurações do servidor
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuItem
                    icon={<CheckCheck size={14} />}
                    onSelect={() => {
                      // channels only exist once the guild detail is loaded; fall back to clearing the badge
                      if (full) for (const channel of full.channels) markChannelRead(channel.id);
                    }}
                  >
                    Marcar tudo como lido
                  </ContextMenuItem>
                  <ContextMenuItem icon={<Copy size={14} />} onSelect={() => void copyId(guild.id)}>
                    Copiar ID do servidor
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="danger" icon={<LogOut size={14} />} onSelect={() => confirmLeave(guild)}>
                    Sair do servidor
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <Tooltip content="Adicionar um servidor">
        <button
          type="button"
          aria-label="Adicionar um servidor"
          onClick={() => openModal({ kind: 'create-server' })}
          className="flex size-12 items-center justify-center rounded-[24px] border border-divider bg-app text-muted transition-all duration-200 hover:rounded-[14px] hover:border-brand/40 hover:text-brand"
        >
          <Plus size={22} aria-hidden />
        </button>
      </Tooltip>

      <Tooltip content="Entrar em um servidor">
        <button
          type="button"
          aria-label="Entrar com convite"
          onClick={() => openModal({ kind: 'join-server' })}
          className="flex size-12 items-center justify-center rounded-[24px] border border-divider bg-app text-muted transition-all duration-200 hover:rounded-[14px] hover:border-brand/40 hover:text-brand"
        >
          <Compass size={20} aria-hidden />
        </button>
      </Tooltip>
    </nav>
  );
}
