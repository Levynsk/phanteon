import type { GuildWithDetails } from '@phanteon/shared';
import { ChevronDown, Copy, FolderPlus, Hash, Link2, LogOut, Settings, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../app/stores/auth';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { Permission } from '@phanteon/shared';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItemContent,
} from '../../components/ui/DropdownMenu';
import { toast } from '../../components/ui/Toast';

interface GuildHeaderMenuProps {
  guild: GuildWithDetails;
}

export function GuildHeaderMenu({ guild }: GuildHeaderMenuProps) {
  const currentUser = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const removeGuild = useChatStore((state) => state.removeGuild);
  const navigate = useNavigate();

  if (!currentUser) return null;

  const isOwner = guild.ownerId === currentUser.id;
  const canManageChannels = canInGuild(guild, Permission.ManageChannels);
  const canCreateInvites = canInGuild(guild, Permission.CreateInvite);
  // the same gate UserDock uses; the modal also enforces it on open
  const canManageGuild = canInGuild(
    guild,
    Permission.ManageGuild,
    Permission.ManageChannels,
    Permission.ManageRoles,
    Permission.ManageMembers,
    Permission.BanMembers,
  );

  const copyInviteCode = async () => {
    try {
      const { invite } = await api.guilds.createInvite(guild.id);
      await navigator.clipboard.writeText(invite.code);
      toast.success('Código de convite copiado', invite.code);
    } catch (error) {
      toast.error('Falha ao copiar convite', error instanceof Error ? error.message : undefined);
    }
  };

  const confirmLeaveOrDelete = () => {
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
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-12 w-full items-center justify-between px-4 text-left shadow-[inset_0_-1px_0_var(--color-divider)] transition-colors hover:bg-hover data-[state=open]:bg-hover">
        <span className="truncate text-[15px] font-semibold text-heading">{guild.name}</span>
        <ChevronDown size={16} className="shrink-0 text-normal" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-[232px]">
        {canCreateInvites ? (
          <DropdownMenuItem onSelect={() => openModal({ kind: 'invite', guildId: guild.id })}>
            <MenuItemContent icon={<Link2 size={14} />}>Convidar pessoas</MenuItemContent>
          </DropdownMenuItem>
        ) : (
          // keep the entry visible but explain why it is disabled instead of hiding it silently
          <DropdownMenuItem disabled>
            <MenuItemContent icon={<Link2 size={14} />}>Convidar pessoas (sem permissão)</MenuItemContent>
          </DropdownMenuItem>
        )}
        {canManageChannels ? (
          <>
            <DropdownMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId: guild.id })}>
              <MenuItemContent icon={<Hash size={14} />}>Criar canal</MenuItemContent>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openModal({ kind: 'create-category', guildId: guild.id })}>
              <MenuItemContent icon={<FolderPlus size={14} />}>Criar categoria</MenuItemContent>
            </DropdownMenuItem>
          </>
        ) : null}
        {canManageGuild ? (
          <DropdownMenuItem onSelect={() => openModal({ kind: 'guild-settings', guildId: guild.id })}>
            <MenuItemContent icon={<Settings size={14} />}>Configurações do servidor</MenuItemContent>
          </DropdownMenuItem>
        ) : null}
        {canCreateInvites ? (
          <DropdownMenuItem onSelect={() => void copyInviteCode()}>
            <MenuItemContent icon={<Copy size={14} />}>Copiar convite</MenuItemContent>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Zona de perigo</DropdownMenuLabel>
        <DropdownMenuItem variant="danger" onSelect={confirmLeaveOrDelete}>
          <MenuItemContent icon={isOwner ? <Trash2 size={14} /> : <LogOut size={14} />}>
            {isOwner ? 'Excluir servidor' : 'Sair do servidor'}
          </MenuItemContent>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
