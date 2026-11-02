import { currentToken } from '../../lib/api';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Check, Clock, MessageSquare, UserPlus } from 'lucide-react';
import type { FriendsOverview, GuildMember, RelationshipKind } from '@phanteon/shared';
import { useAuthStore } from '../../app/stores/auth';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { StatusDot, STATUS_LABEL } from '../ui/Status';
import { assetUrl } from '../../lib/asset-url';
import { toast } from '../ui/Toast';

export function UserCard({ userId }: { userId: string }) {
  const close = useUiStore((state) => state.closeModal);
  const currentUser = useAuthStore((state) => state.user);
  const openDm = useChatStore((state) => state.openDm);
  const presence = useChatStore((state) => state.presence);
  const navigate = useNavigate();
  const isMe = userId === currentUser?.id;
  const [member, setMember] = useState<GuildMember | null>(null);
  const [profileUser, setProfileUser] = useState(currentUser?.id === userId ? currentUser : null);
  const [loading, setLoading] = useState(true);
  const [friendKind, setFriendKind] = useState<RelationshipKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMember(null);
    setProfileUser(currentUser?.id === userId ? currentUser : null);
    setLoading(true);
    void (async () => {
      try {
        const [{ member: profile }, { user: fetchedUser }] = await Promise.all([
          api.users.profile(userId).catch(() => ({ member: null })),
          api.users.get(userId),
        ]);
        if (cancelled) return;
        setMember(profile);
        setProfileUser(currentUser?.id === userId ? currentUser : fetchedUser);
      } catch {
        if (!cancelled) setProfileUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, currentUser]);

  useEffect(() => {
    if (!isMe) api.friends.kind(userId).then(({ relationship }) => setFriendKind(relationship)).catch(() => undefined);
  }, [userId, isMe]);

  const user = isMe ? currentUser : profileUser;
  const shownStatus = presence[userId] ?? user?.status ?? 'offline';
  const syncFriends = (friends: FriendsOverview) => {
    useChatStore.setState({ friends });
    const entry = friends.friends.concat(friends.incoming, friends.outgoing, friends.blocked).find((row) => row.user.id === userId) ?? null;
    setFriendKind(entry?.kind ?? null);
  };

  const addFriend = async () => {
    try { const { friends } = await api.friends.request(userId); syncFriends(friends); toast.success('Pedido de amizade enviado'); }
    catch (error) { toast.error('Não foi possível adicionar', error instanceof Error ? error.message : undefined); }
  };
  const acceptFriend = async () => {
    try { const { friends } = await api.friends.accept(userId); syncFriends(friends); toast.success('Pedido aceito'); }
    catch (error) { toast.error('Não foi possível aceitar', error instanceof Error ? error.message : undefined); }
  };
  const toggleBlock = async () => {
    try {
      const blocked = friendKind === 'blocked';
      const { friends } = blocked ? await api.friends.unblock(userId) : await api.friends.block(userId);
      syncFriends(friends);
      toast.success(blocked ? 'Usuário desbloqueado' : 'Usuário bloqueado');
      if (!blocked) close();
    } catch (error) { toast.error('Não foi possível alterar o bloqueio', error instanceof Error ? error.message : undefined); }
  };
  const openConversation = async () => {
    try { const dm = await openDm(userId); close(); navigate(`/app/dm/${dm.id}`); }
    catch (error) { toast.error('Falha ao abrir conversa', error instanceof Error ? error.message : undefined); }
  };

  return (
    <article className="w-[min(360px,calc(100vw-16px))] overflow-y-auto rounded-xl border border-line-strong bg-chat shadow-2xl">
      {/* without a banner the strip is the user's colour at full strength, not a fade */}
      <div
        className="relative h-[86px] overflow-hidden"
        style={{ backgroundColor: user?.accentColor ?? 'var(--color-brand)' }}
      >
        {user?.bannerUrl ? <img src={assetUrl(user.bannerUrl, { token: currentToken() })} alt="Banner do perfil" className="absolute inset-0 size-full object-cover" /> : null}
      </div>
      <div className="px-5 pb-5">
        <div className="relative -mt-10 flex items-end justify-between">
          {user ? (
            <div className="rounded-full border-[5px] border-chat">
              <Avatar
                name={user.displayName}
                src={user.avatarUrl}
                color={user.accentColor}
                size="lg"
                badge={<StatusDot status={shownStatus} className="-translate-y-3 size-5 border-[4px] border-chat" />}
                badgeRing="border-chat"
              />
            </div>
          ) : <span className="size-20 rounded-full border-[5px] border-chat bg-input" />}
          {user ? <span className="sr-only">{STATUS_LABEL[shownStatus]}</span> : null}
        </div>
        {user ? <>
          <div className="mt-3 border-b border-divider pb-4">
            <h2 className="truncate text-xl font-bold text-heading">{user.displayName}</h2>
            <p className="truncate text-sm text-muted">@{user.username}</p>
            {user.bio ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-normal">{user.bio}</p> : <p className="mt-3 text-sm italic text-faint">Sem bio.</p>}
          </div>
          {member ? <div className="mt-4 space-y-3 text-sm">
            <Info label="Conta criada em">{formatDate(user.createdAt)}</Info>
            {member.guildId ? <Info label="Membro desde">{formatDate(member.joinedAt)}<RoleList guildId={member.guildId} roleIds={member.roleIds} /></Info> : null}
          </div> : <Info label="Conta criada em">{formatDate(user.createdAt)}</Info>}
          {!isMe ? <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="primary" onClick={() => void openConversation()}><MessageSquare size={15} aria-hidden /> Mensagem</Button>
              {friendKind === 'friend' ? <Button variant="secondary" disabled><Check size={15} aria-hidden /> Amigos</Button> : friendKind === 'incoming' ? <Button variant="success" onClick={() => void acceptFriend()}><Check size={15} aria-hidden /> Aceitar</Button> : friendKind === 'outgoing' ? <Button variant="secondary" disabled><Clock size={15} aria-hidden /> Pedido enviado</Button> : friendKind === 'blocked' || friendKind === 'blockedBy' ? <Button variant="secondary" disabled><Ban size={15} aria-hidden /> Bloqueado</Button> : <Button variant="secondary" onClick={() => void addFriend()}><UserPlus size={15} aria-hidden /> Adicionar</Button>}
            </div>
            <button type="button" onClick={() => void toggleBlock()} className="mx-auto mt-3 block text-xs text-muted transition-colors hover:text-red">{friendKind === 'blocked' ? 'Desbloquear usuário' : 'Bloquear usuário'}</button>
          </> : null}
        </> : loading ? <p className="py-6 text-center text-sm text-muted">Carregando perfil…</p> : <p className="py-6 text-center text-sm text-muted">Este perfil não está disponível.</p>}
      </div>
    </article>
  );
}

function RoleList({ guildId, roleIds }: { guildId: string; roleIds: string[] }) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const roles = guild ? roleIds.map((id) => guild.roles.find((role) => role.id === id)).filter((role) => role && !role.isEveryone) : [];
  if (roles.length === 0) return <div className="mt-1 text-muted">Sem cargos</div>;
  return <div className="mt-1 flex flex-wrap gap-1">{roles.map((role) => <span key={role!.id} className="inline-flex items-center gap-1 rounded-sm border border-divider px-1.5 py-0.5 text-[12px] font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: role!.color }} aria-hidden />{role!.name}</span>)}</div>;
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div><div className="mt-0.5 text-normal">{children}</div></div>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
