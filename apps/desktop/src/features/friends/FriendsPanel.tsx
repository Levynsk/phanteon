import { useMemo, useState } from 'react';
import { Check, Clock, MessageSquare, Plus, UserMinus, UserPlus, X } from 'lucide-react';
import type { Relationship, UserStatus } from '@phanteon/shared';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { StatusBadge, STATUS_LABEL } from '../../components/ui/Status';
import { InlineSearch } from '../../components/ui/SearchInput';
import { Tooltip } from '../../components/ui/Tooltip';
import { toast } from '../../components/ui/Toast';

interface FriendsPanelProps {
  /** Hide the "Amigos / adicionar" heading when the parent already renders one. */
  showHeader?: boolean;
  /** Opens a conversation; defaults to the DM route. */
  onOpenChat?: (userId: string) => void;
}

/** Friend list: requests, friends by status and blocks. Used in the sidebar and the DM panel. */
export function FriendsPanel({ showHeader = true, onOpenChat }: FriendsPanelProps = {}) {
  const friends = useChatStore((state) => state.friends);
  const presence = useChatStore((state) => state.presence);
  const online = useChatStore((state) => state.online);
  const setFriends = (next: Awaited<ReturnType<typeof api.friends.list>>['friends']) =>
    useChatStore.setState({ friends: next });
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (userId: string, action: () => ReturnType<typeof api.friends.list>, success: string) => {
    setBusy(userId);
    try {
      const { friends: next } = await action();
      setFriends(next);
      toast.success(success);
    } catch (error) {
      toast.error('Não foi possível concluir', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const term = query.trim().toLowerCase();
  const visible = (list: Relationship[]) =>
    list.filter((entry) => !term || entry.user.displayName.toLowerCase().includes(term) || entry.user.username.toLowerCase().includes(term));

  const grouped = useMemo(() => {
    const list = visible(friends?.friends ?? []);
    const byStatus = (status: UserStatus) =>
      list
        .filter((entry) => (online[entry.user.id] ? (presence[entry.user.id] ?? 'online') : 'offline') === status)
        .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
    return {
      online: byStatus('online'),
      idle: byStatus('idle'),
      dnd: byStatus('dnd'),
      offline: byStatus('offline'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends?.friends, online, presence, term]);

  const statusOf = (userId: string): UserStatus => (online[userId] ? (presence[userId] ?? 'online') : 'offline');

  const row = (entry: Relationship, actions: React.ReactNode) => (
    <li
      key={`${entry.kind}:${entry.user.id}`}
      className="group flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-hover"
    >
      <span className="relative inline-flex shrink-0">
        <Avatar name={entry.user.displayName} src={entry.user.avatarUrl} color={entry.user.accentColor} size="sm" />
        <StatusBadge status={statusOf(entry.user.id)} ring="surface" size="sm" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-normal">{entry.user.displayName}</span>
        {entry.kind !== 'friend' ? (
          <span className="block truncate text-[11px] text-muted">
            {entry.kind === 'incoming'
              ? 'Pedido de amizade recebido'
              : entry.kind === 'outgoing'
                ? 'Pedido pendente'
                : `@${entry.user.username}`}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </span>
    </li>
  );

  const actionButton = (label: string, icon: React.ReactNode, onClick: () => void, danger = false, disabled = false) => (
    <Tooltip content={label} side="top">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex size-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-heading disabled:opacity-40',
          danger && 'hover:bg-red/15 hover:text-red',
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );

  const openChat = async (userId: string) => {
    try {
      if (onOpenChat) {
        onOpenChat(userId);
        return;
      }
      const { channelId } = await api.dms.with(userId);
      const dm = channelId ? null : await useChatStore.getState().openDm(userId);
      navigate(`/app/dm/${channelId ?? dm!.id}`);
    } catch (error) {
      toast.error('Falha ao abrir conversa', error instanceof Error ? error.message : undefined);
    }
  };

  const section = (title: string, list: Relationship[], render: (entry: Relationship) => React.ReactNode) =>
    list.length > 0 ? (
      <section className="mb-3">
        <h3 className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">
          {title} — {list.length}
        </h3>
        <ul className="flex flex-col gap-px">{list.map(render)}</ul>
      </section>
    ) : null;

  const incoming = visible(friends?.incoming ?? []);
  const outgoing = visible(friends?.outgoing ?? []);
  const blocked = visible(friends?.blocked ?? []);

  return (
    <>
      <div className={cn('mb-1 flex items-center justify-between px-1', !showHeader && 'hidden')}>
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Amigos</span>
        <Tooltip content="Adicionar amigo" side="top" delayDuration={300}>
          <button
            type="button"
            aria-label="Adicionar amigo"
            className="rounded-sm p-0.5 text-muted hover:text-heading"
            onClick={() => openModal({ kind: 'add-friend' })}
          >
            <UserPlus size={14} aria-hidden />
          </button>
        </Tooltip>
      </div>

      <div className={cn('mb-2', showHeader ? 'px-1' : undefined)}>
        <InlineSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar amigos"
          aria-label="Buscar amigos"
        />
      </div>

      {!friends ? (
        <p className="px-3 py-3 text-[13px] text-muted">Carregando…</p>
      ) : (
        <>
          {section('Pedidos pendentes', incoming, (entry) =>
            row(
              entry,
              <>
                {actionButton('Aceitar', <Check size={15} aria-hidden />, () =>
                  void run(entry.user.id, () => api.friends.accept(entry.user.id), `${entry.user.displayName} agora é seu amigo`),
                  false,
                  busy === entry.user.id,
                )}
                {actionButton('Recusar', <X size={15} aria-hidden />, () =>
                  void run(entry.user.id, () => api.friends.decline(entry.user.id), 'Pedido recusado'),
                  true,
                  busy === entry.user.id,
                )}
              </>,
            ),
          )}
          {section('Pedidos enviados', outgoing, (entry) =>
            row(
              entry,
              <>
                <Clock size={14} className="mx-1.5 text-faint" aria-hidden />
                {actionButton('Cancelar pedido', <X size={15} aria-hidden />, () =>
                  void run(entry.user.id, () => api.friends.decline(entry.user.id), 'Pedido cancelado'),
                  true,
                  busy === entry.user.id,
                )}
              </>,
            ),
          )}
          {section('Bloqueados', blocked, (entry) =>
            row(
              entry,
              actionButton('Desbloquear', <UserPlus size={15} aria-hidden />, () =>
                void run(entry.user.id, () => api.friends.unblock(entry.user.id), `${entry.user.displayName} desbloqueado`),
                false,
                busy === entry.user.id,
              ),
            ),
          )}

          {(['online', 'idle', 'dnd', 'offline'] as UserStatus[]).map((status) =>
            section(
              `${STATUS_LABEL[status]}`,
              status === 'online'
                ? [...grouped.online, ...grouped.idle, ...grouped.dnd]
                : status === 'offline'
                  ? grouped.offline
                  : [],
              (entry) =>
                row(
                  entry,
                  <>
                    {actionButton('Mensagem', <MessageSquare size={15} aria-hidden />, () => void openChat(entry.user.id))}
                    {actionButton('Remover amigo', <UserMinus size={15} aria-hidden />, () =>
                      void run(entry.user.id, () => api.friends.remove(entry.user.id), `${entry.user.displayName} removido(a)`),
                      true,
                      busy === entry.user.id,
                    )}
                  </>,
                ),
            ),
          )}

          {visible(friends.friends).length === 0 && incoming.length === 0 && outgoing.length === 0 && blocked.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
              <p className="text-[13px] text-muted">
                {term ? 'Nenhum amigo encontrado.' : 'Ninguém por aqui ainda. Adicione pelo @usuário ou ID.'}
              </p>
              <Button variant="primary" size="sm" onClick={() => openModal({ kind: 'add-friend' })}>
                <Plus size={14} aria-hidden /> Adicionar amigo
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
