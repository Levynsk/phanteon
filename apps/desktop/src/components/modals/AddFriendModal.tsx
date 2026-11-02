import { useEffect, useState } from 'react';
import { Check, Clock, UserPlus, X } from 'lucide-react';
import type { PublicUser, RelationshipKind } from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';

const ACTION_LABEL: Record<RelationshipKind, string> = {
  friend: 'Já são amigos',
  incoming: 'Aceitar pedido',
  outgoing: 'Pedido enviado',
  blocked: 'Bloqueado por você',
  blockedBy: 'Bloqueado',
};

export function AddFriendModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const open = modal?.kind === 'add-friend';
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [kinds, setKinds] = useState<Record<string, RelationshipKind | null>>({});
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setUsers([]);
      setKinds({});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { users: found } = await api.users.search(term);
        if (cancelled) return;
        setUsers(found.slice(0, 8));
        const entries = await Promise.all(
          found.slice(0, 8).map(async (user) => {
            const { relationship } = await api.friends.kind(user.id);
            return [user.id, relationship] as const;
          }),
        );
        if (!cancelled) setKinds(Object.fromEntries(entries));
      } catch {
        // a failed lookup just leaves the list unchanged
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const refresh = async () => {
    const { friends } = await api.friends.list();
    useChatStore.setState({ friends });
  };

  const act = async (user: PublicUser) => {
    const kind = kinds[user.id] ?? null;
    setBusy(user.id);
    try {
      if (kind === 'incoming') {
        const { friends } = await api.friends.accept(user.id);
        useChatStore.setState({ friends });
        toast.success(`Você e ${user.displayName} agora são amigos`);
      } else if (kind === 'friend' || kind === 'outgoing') {
        return;
      } else if (kind === 'blocked' || kind === 'blockedBy') {
        toast.error('Não é possível enviar pedido', 'Desbloqueie este usuário antes.');
        return;
      } else {
        const { friends } = await api.friends.request(user.id);
        useChatStore.setState({ friends });
        toast.success(`Pedido de amizade enviado para ${user.displayName}`);
      }
      const { relationship } = await api.friends.kind(user.id);
      setKinds((current) => ({ ...current, [user.id]: relationship }));
      await refresh();
    } catch (error) {
      toast.error('Não foi possível enviar o pedido', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Adicionar amigo"
        description="Digite o nome, o @usuário ou o ID de quem você quer adicionar."
      >
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="@usuario ou ID"
          aria-label="Buscar por @usuário ou ID"
        />
        <ul className="mt-3 flex flex-col gap-1">
          {users.map((user) => {
            const kind = kinds[user.id] ?? null;
            const disabled = kind === 'friend' || kind === 'outgoing' || kind === 'blocked' || kind === 'blockedBy';
            return (
              <li key={user.id} className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-hover">
                <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-heading">{user.displayName}</span>
                  <span className="block truncate text-xs text-muted">@{user.username}</span>
                </span>
                {kind === 'incoming' ? (
                  <Button variant="success" size="sm" onClick={() => void act(user)} loading={busy === user.id}>
                    <Check size={14} aria-hidden /> Aceitar
                  </Button>
                ) : kind === 'friend' ? (
                  <span className="flex items-center gap-1 text-xs text-green">
                    <Check size={13} aria-hidden /> {ACTION_LABEL.friend}
                  </span>
                ) : kind === 'outgoing' ? (
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Clock size={13} aria-hidden /> {ACTION_LABEL.outgoing}
                  </span>
                ) : kind === 'blocked' || kind === 'blockedBy' ? (
                  <span className="flex items-center gap-1 text-xs text-red">
                    <X size={13} aria-hidden /> {ACTION_LABEL[kind]}
                  </span>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => void act(user)} loading={busy === user.id} disabled={disabled}>
                    <UserPlus size={14} aria-hidden /> Enviar pedido
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {query.trim() && !searching && users.length === 0 ? (
          <p className="mt-3 text-center text-sm text-muted">Nenhum usuário encontrado com “{query.trim()}”.</p>
        ) : null}
        {!query.trim() ? (
          <p className="mt-3 text-xs text-muted">Você também pode copiar o ID na aba “Meu perfil” para compartilhar.</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
