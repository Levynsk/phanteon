import type { GuildMember, UserStatus } from '@phanteon/shared';
import { Crown, Hammer, MessageSquare, Shield, User, UserMinus } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../app/stores/auth';
import { Permission } from '@phanteon/shared';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { cn } from '../../lib/cn';
import { MemberName } from '../../components/ui/MemberName';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItemContent,
} from '../../components/ui/DropdownMenu';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { ResizablePanel } from '../../components/layout/ResizablePanel';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu';
import { StatusBadge } from '../../components/ui/Status';
import { toast } from '../../components/ui/Toast';

export function MemberList({ guildId }: MemberListProps) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const online = useChatStore((state) => state.online);
  const presence = useChatStore((state) => state.presence);

  const groups = useMemo(() => {
    // members are grouped by their highest role, then by name (Discord style)
    const roleOrder = (member: GuildMember) => {
      const top = member.roleIds
        .map((id) => guild?.roles.find((role) => role.id === id))
        .find((role) => role && !role.isEveryone);
      return top?.position ?? 0;
    };
    const sorted = [...(guild?.members ?? [])].sort(
      (a, b) => roleOrder(b) - roleOrder(a) || a.user.displayName.localeCompare(b.user.displayName),
    );
    return {
      online: sorted.filter((member) => online[member.user.id]),
      offline: sorted.filter((member) => !online[member.user.id]),
    };
  }, [guild?.members, online]);

  if (!guild) return null;

  return (
    // same column tone as the channel sidebar on the left, so the frame reads as one shell
    <ResizablePanel panel="members" label="Membros do servidor" resizeLabel="Redimensionar lista de membros" className="bg-sidebar">
      <ScrollArea className="h-full" viewportClassName="px-2 py-4">
        <MemberGroup title={`Online — ${groups.online.length}`} members={groups.online} guildId={guildId} presence={presence} />
        {groups.offline.length > 0 ? (
          <MemberGroup
            title={`Offline — ${groups.offline.length}`}
            members={groups.offline}
            guildId={guildId}
            presence={presence}
          />
        ) : null}
      </ScrollArea>
    </ResizablePanel>
  );
}

interface MemberListProps {
  guildId: string;
}

function MemberGroup({
  title,
  members,
  guildId,
  presence,
}: {
  title: string;
  members: GuildMember[];
  guildId: string;
  presence: Record<string, UserStatus>;
}) {
  if (members.length === 0) return null;
  return (
    <section className="mb-4" aria-label={title}>
      <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <MemberRow key={member.user.id} member={member} guildId={guildId} status={presence[member.user.id] ?? 'offline'} />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({ member, guildId, status }: { member: GuildMember; guildId: string; status: UserStatus }) {
  const currentUser = useAuthStore((state) => state.user);
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const online = useChatStore((state) => state.online);
  const openDm = useChatStore((state) => state.openDm);
  const removeMemberFromGuild = useChatStore((state) => state.removeMemberFromGuild);
  const openModal = useUiStore((state) => state.openModal);
  const openUserProfile = useUiStore((state) => state.openUserProfile);
  const profilePointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const navigate = useNavigate();

  const isMe = member.user.id === currentUser?.id;
  const isOnline = online[member.user.id] ?? false;
  const canKick = canInGuild(guild, Permission.ManageMembers);
  const canBan = canInGuild(guild, Permission.BanMembers);
  const viewerPosition = currentUser ? (guild?.members.find((e) => e.user.id === currentUser.id)?.position ?? 0) : 0;
  // hierarchy: owners can act on everyone except themselves; others only below
  const outranks = !!guild && (guild.isOwner || member.position < viewerPosition);
  const targetIsOwner = guild?.ownerId === member.user.id;
  const canModerateTarget = canKick && !isMe && !targetIsOwner && outranks;
  const canBanTarget = canBan && !isMe && !targetIsOwner && outranks;

  const startDm = async () => {
    try {
      const dm = await openDm(member.user.id);
      navigate(`/app/dm/${dm.id}`);
    } catch (error) {
      toast.error('Falha ao abrir conversa', error instanceof Error ? error.message : undefined);
    }
  };

  const openRoleSettings = () => openModal({ kind: 'guild-settings', guildId, section: 'members' });

  const kick = async () => {
    try {
      await api.guilds.removeMember(guildId, member.user.id);
      removeMemberFromGuild(guildId, member.user.id);
      toast.success(`${member.user.displayName} foi removido(a) do servidor`);
    } catch (error) {
      toast.error('Falha ao remover membro', error instanceof Error ? error.message : undefined);
    }
  };

  // Rows are transparent by default and hover with the plain theme overlay:
  // no banner or accent colour behind the list, so it reads as one surface.
  const identity = (
    <span className="relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-sm px-2 py-1 transition-colors group-hover/row:bg-hover group-data-[state=open]/row:bg-hover">
      <span className="relative inline-flex shrink-0">
        <Avatar name={member.user.displayName} src={member.user.avatarUrl} color={member.user.accentColor} size="sm" />
        <StatusBadge status={isOnline ? status : 'offline'} ring="surface" size="sm" />
      </span>
      <span className="relative flex min-w-0 items-center gap-1">
        <span className={cn('truncate text-[15px] text-normal', !isOnline && 'opacity-50')}>
          <MemberName user={member.user} guildId={guildId} />
        </span>
        {member.role === 'owner' ? (
          <Crown size={12} className="shrink-0 text-yellow" aria-label="Dono" />
        ) : member.role === 'admin' ? (
          <Shield size={12} className="shrink-0 text-yellow" aria-label="Administrador" />
        ) : null}
      </span>
    </span>
  );

  // one set of actions, reachable by click or by right-click
  const actions = [
    {
      key: 'profile',
      icon: <User size={14} />,
      label: 'Ver perfil',
      run: () => openUserProfile(member.user.id, guildId, profilePointer.current, document.activeElement instanceof HTMLElement ? document.activeElement : null),
    },
    { key: 'dm', icon: <MessageSquare size={14} />, label: 'Enviar mensagem', run: () => void startDm() },
  ];
  const moderation = canModerateTarget
    ? [
        { key: 'roles', icon: <Shield size={14} />, label: 'Gerenciar cargos', run: openRoleSettings },
        { key: 'kick', icon: <UserMinus size={14} />, label: 'Expulsar do servidor', danger: true, run: () => void kick() },
        ...(canBanTarget
          ? [
              {
                key: 'ban',
                icon: <Hammer size={14} />,
                label: 'Banir do servidor',
                danger: true,
                run: () =>
                  openModal({ kind: 'ban-member', guildId, userId: member.user.id, displayName: member.user.displayName }),
              },
            ]
          : []),
      ]
    : [];

  if (isMe) {
    return <li className="group/row"><button type="button" onClick={(event) => openUserProfile(member.user.id, guildId, { x: event.clientX, y: event.clientY }, event.currentTarget)} className="block w-full rounded-sm text-left">{identity}</button></li>;
  }

  return (
    <li>
      <ContextMenu>
        <DropdownMenu>
          <ContextMenuTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(event) => { profilePointer.current = event.detail > 0 ? { x: event.clientX, y: event.clientY } : undefined; }}
                onContextMenu={(event) => { profilePointer.current = { x: event.clientX, y: event.clientY }; }}
                className="group/row block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
                aria-label={`Ações de ${member.user.displayName}`}
              >
                {identity}
              </button>
            </DropdownMenuTrigger>
          </ContextMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-[200px]">
            {actions.map((action) => (
              <DropdownMenuItem key={action.key} onSelect={action.run}>
                <MenuItemContent icon={action.icon}>{action.label}</MenuItemContent>
              </DropdownMenuItem>
            ))}
            {moderation.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                {moderation.map((action) => (
                  <DropdownMenuItem key={action.key} variant={action.danger ? 'danger' : 'default'} onSelect={action.run}>
                    <MenuItemContent icon={action.icon}>{action.label}</MenuItemContent>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenuContent className="w-[200px]">
          {actions.map((action) => (
            <ContextMenuItem key={action.key} icon={action.icon} onSelect={action.run}>
              {action.label}
            </ContextMenuItem>
          ))}
          {moderation.length > 0 ? (
            <>
              <ContextMenuSeparator />
              {moderation.map((action) => (
                <ContextMenuItem key={action.key} icon={action.icon} variant={action.danger ? 'danger' : 'default'} onSelect={action.run}>
                  {action.label}
                </ContextMenuItem>
              ))}
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
