import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { GuildMember, PublicUser } from '@phanteon/shared';
import { useUiStore } from '../../app/stores/ui';
import { useChatStore } from '../../app/stores/chat';
import { api } from '../../lib/api';
import { UserCard } from './UserCard';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { toast } from '../ui/Toast';

export function UserProfileModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const isOpen = modal?.kind === 'user-profile';
  const userId = isOpen ? modal.userId : null;
  const at = isOpen ? modal.at : null;

  useEffect(() => {
    if (!isOpen || !at) return;
    const card = cardRef.current;
    if (!card) return;
    const place = () => {
      const margin = 8;
      const { width, height } = card.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);
      const left = at.x + width > window.innerWidth - margin ? at.x - width : at.x;
      const top = at.y + height > window.innerHeight - margin ? at.y - height : at.y;
      setPosition({
        left: Math.max(margin, Math.min(left, maxLeft)),
        top: Math.max(margin, Math.min(top, maxTop)),
      });
    };
    const observer = new ResizeObserver(place);
    observer.observe(card);
    place();
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [isOpen, at, userId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isOpen, close]);

  if (!userId) return null;
  return (
    <div ref={cardRef} className="fixed z-[80] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl" style={{ left: position.left, top: position.top }} onPointerDown={(event) => event.stopPropagation()}>
      <UserCard key={userId} userId={userId} />
    </div>
  );
}

export function NewDmModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const openDm = useChatStore((state) => state.openDm);
  const navigate = useNavigate();
  const open = modal?.kind === 'new-dm';
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.users
        .search(query)
        .then(({ users: results }) => {
          if (!cancelled) setUsers(results);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const start = async (userId: string) => {
    try {
      const dm = await openDm(userId);
      close();
      navigate(`/app/dm/${dm.id}`);
    } catch (error) {
      toast.error('Falha ao abrir conversa', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent title="Selecione um amigo" description="Escolha alguém para iniciar uma conversa direta.">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por nome de usuário"
          aria-label="Buscar usuários"
          className="mb-3"
        />
        <ul className="flex max-h-[340px] flex-col gap-1 overflow-y-auto">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => void start(user.id)}
                className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-hover"
              >
                <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] text-heading">{user.displayName}</span>
                  <span className="truncate text-xs text-muted">@{user.username}</span>
                </span>
                <MessageSquare size={14} className="ml-auto text-muted" aria-hidden />
              </button>
            </li>
          ))}
          {!loading && users.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted">Nenhum usuário encontrado.</li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
