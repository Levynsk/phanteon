import { CheckCheck, Copy, MessageCircle, Plus, User, UserPlus, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../app/stores/auth';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { useNotificationStore } from '../../app/stores/notifications';
import { formatRelativeShort } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { InlineSearch } from '../../components/ui/SearchInput';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { StatusBadge } from '../../components/ui/Status';
import { Tooltip } from '../../components/ui/Tooltip';
import { toast } from '../../components/ui/Toast';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu';

/**
 * DM column: conversations first, friends in the same list (no tabs). Clicking
 * a friend opens their DM; clicking the "Amigos" heading shows the full friend
 * list in the main panel, where requests can be accepted.
 */
export function DmSidebar() {
  const currentUser = useAuthStore((state) => state.user);
  const dms = useChatStore((state) => state.dms);
  const presence = useChatStore((state) => state.presence);
  const onlineUsers = useChatStore((state) => state.online);
  const friends = useChatStore((state) => state.friends);
  const { guildId, channelId } = useParams();
  const openUserProfile = useUiStore((state) => state.openUserProfile);
  const openModal = useUiStore((state) => state.openModal);
  const profilePointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const markChannelRead = useNotificationStore((state) => state.markChannelRead);
  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('ID copiado');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);
  const unread = useNotificationStore((state) => state.unread);
  const [query, setQuery] = useState('');
  const [showFriends, setShowFriends] = useState(true);
  const navigate = useNavigate();

  const openDmWith = async (userId: string) => {
    try {
      const dm = await useChatStore.getState().openDm(userId);
      navigate(`/app/dm/${dm.id}`);
    } catch (error) {
      toast.error('Falha ao abrir conversa', error instanceof Error ? error.message : undefined);
    }
  };

  const pendingCount = friends?.incoming.length ?? 0;

  const term = query.trim().toLowerCase();
  const filteredDms = useMemo(() => {
    if (!term) return dms;
    return dms.filter((dm) =>
      dm.recipients.some(
        (user) =>
          user.id !== currentUser?.id &&
          (user.displayName.toLowerCase().includes(term) || user.username.toLowerCase().includes(term)),
      ),
    );
  }, [dms, term, currentUser?.id]);

  const friendList = useMemo(() => {
    const list = friends?.friends ?? [];
    if (!term) return list;
    return list.filter(
      (entry) =>
        entry.user.displayName.toLowerCase().includes(term) || entry.user.username.toLowerCase().includes(term),
    );
  }, [friends?.friends, term]);

  const friendsView = guildId === 'dm' && !channelId;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-divider bg-sidebar" aria-label="Mensagens diretas">
      <div className="flex h-12 items-center gap-1.5 border-b border-divider px-2.5">
        <InlineSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim()) setSearchOpen(true);
          }}
          placeholder="Encontrar uma conversa"
          aria-label="Buscar conversas"
          className="[&>svg]:left-2"
        />
        <Tooltip content="Nova mensagem direta" side="bottom" delayDuration={300}>
          <button
            type="button"
            aria-label="Nova mensagem direta"
            className="shrink-0 rounded-sm p-1 text-muted hover:text-heading"
            onClick={() => openModal({ kind: 'new-dm' })}
          >
            <Plus size={15} aria-hidden />
          </button>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1" viewportClassName="px-2 pb-24 pt-2">
        <Link
          to="/app/dm"
          aria-current={friendsView ? 'page' : undefined}
          className={cn(
            'mb-1 flex items-center gap-2 rounded-sm px-2 py-[6px] text-[15px] transition-colors',
            friendsView ? 'bg-selected font-medium text-heading' : 'text-muted hover:bg-hover hover:text-normal',
          )}
        >
          <Users size={16} className="shrink-0" aria-hidden />
          <span className="flex-1 truncate">Amigos</span>
          {pendingCount > 0 ? (
            <span className="flex min-w-4 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold leading-4 text-on-brand">
              {pendingCount}
            </span>
          ) : null}
        </Link>

        <ul className="flex flex-col gap-0.5">
          {filteredDms.map((dm) => {
            const other = dm.recipients.find((user) => user.id !== currentUser?.id) ?? dm.recipients[0];
            if (!other) return null;
            const status = presence[other.id] ?? 'offline';
            const active = guildId === 'dm' && channelId === dm.id;
            const count = unread[dm.id] ?? 0;
            return (
              <li key={dm.id}>
                <ContextMenu>
                <ContextMenuTrigger asChild>
                <Link
                  to={`/app/dm/${dm.id}`}
                  aria-current={active ? 'page' : undefined}
                  onContextMenu={(event) => { profilePointer.current = { x: event.clientX, y: event.clientY }; }}
                  className={cn(
                    'group relative flex items-center gap-2 rounded-sm px-2 py-[6px] text-[15px] transition-colors',
                    active
                      ? 'bg-selected font-medium text-heading'
                      : cn(
                          'text-muted hover:bg-hover hover:text-normal',
                          count > 0 && 'font-semibold text-heading',
                        ),
                  )}
                >
                  <span className="relative inline-flex shrink-0">
                    <Avatar name={other.displayName} src={other.avatarUrl} color={other.accentColor} size="sm" />
                    <StatusBadge status={status} ring="surface-alt" size="sm" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate">{other.displayName}</span>
                    {dm.lastMessageAt ? (
                      <span className={cn('truncate text-[11px] text-faint', count > 0 && 'text-muted')}>
                        {formatRelativeShort(dm.lastMessageAt)}
                      </span>
                    ) : null}
                  </span>
                  {count > 0 ? (
                    <span
                      className="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold leading-4 text-on-brand"
                      aria-label={`${count} mensagens não lidas`}
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  ) : null}
                </Link>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-[212px]">
                  <ContextMenuItem icon={<User size={14} />} onSelect={() => openUserProfile(other.id, undefined, profilePointer.current, document.activeElement instanceof HTMLElement ? document.activeElement : null)}>
                    Ver perfil
                  </ContextMenuItem>
                  <ContextMenuItem icon={<Copy size={14} />} onSelect={() => void copyId(dm.id)}>
                    Copiar ID da conversa
                  </ContextMenuItem>
                  <ContextMenuItem icon={<CheckCheck size={14} />} onSelect={() => markChannelRead(dm.id)}>
                    Marcar como lido
                  </ContextMenuItem>
                  <ContextMenuItem icon={<User size={14} />} onSelect={() => void copyId(other.id)}>
                    Copiar ID do usuário
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              </li>
            );
          })}
          {filteredDms.length === 0 ? (
            <li className="flex flex-col items-start gap-1 px-2 py-2 text-[13px] text-muted">
              <span>{term ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda.'}</span>
              {!term ? (
                <button
                  type="button"
                  onClick={() => openModal({ kind: 'new-dm' })}
                  className="flex items-center gap-1 text-[12px] text-link hover:underline"
                >
                  <MessageCircle size={12} aria-hidden /> Começar uma conversa
                </button>
              ) : null}
            </li>
          ) : null}
        </ul>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowFriends((value) => !value)}
            aria-expanded={showFriends}
            className="flex w-full items-center justify-between px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted hover:text-normal"
          >
            <span>
              Amigos — {(friends?.friends ?? []).length}
              {pendingCount > 0 ? ` · ${pendingCount} pedido${pendingCount > 1 ? 's' : ''}` : ''}
            </span>
            <Tooltip content="Adicionar amigo" side="top" delayDuration={300}>
              <span
                role="button"
                tabIndex={0}
                aria-label="Adicionar amigo"
                onClick={(event) => {
                  event.stopPropagation();
                  openModal({ kind: 'add-friend' });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openModal({ kind: 'add-friend' });
                }}
                className="rounded-sm p-0.5 text-muted hover:text-heading"
              >
                <UserPlus size={13} aria-hidden />
              </span>
            </Tooltip>
          </button>
          {showFriends ? (
            friendList.length === 0 ? (
              <p className="px-2 pb-2 text-[12px] text-faint">
                {term ? 'Nenhum amigo encontrado.' : 'Adicione pessoas pelo @usuário ou ID.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {friendList.slice(0, 20).map((entry) => {
                  const online = onlineUsers[entry.user.id] ?? false;
                  return (
                    <li key={`friend-${entry.user.id}`}>
                      <button
                        type="button"
                        onClick={() => void openDmWith(entry.user.id)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-[5px] text-left text-[14px] text-muted transition-colors hover:bg-hover hover:text-normal"
                      >
                        <span className="relative inline-flex shrink-0">
                          <Avatar
                            name={entry.user.displayName}
                            src={entry.user.avatarUrl}
                            color={entry.user.accentColor}
                            size="xs"
                          />
                          <StatusBadge status={online ? (presence[entry.user.id] ?? 'online') : 'offline'} ring="surface-alt" size="sm" />
                        </span>
                        <span className="truncate">{entry.user.displayName}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
