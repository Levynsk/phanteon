import { MessageSquarePlus, Plus, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../app/stores/auth';
import { useChatStore } from '../app/stores/chat';
import { useUiStore } from '../app/stores/ui';
import { useNotificationStore } from '../app/stores/notifications';
import { realtime } from '../lib/realtime';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ModalHost } from '../components/modals/ModalHost';
import { TitleBar } from '../components/layout/TitleBar';
import { UserDock } from '../components/layout/UserDock';
import { ChannelSidebar } from '../features/channels/ChannelSidebar';
import { DmSidebar } from '../features/dms/DmSidebar';
import { ChannelHeader } from '../features/messages/ChannelHeader';
import { MessageList } from '../features/messages/MessageList';
import { VoiceChannelView } from '../features/voice/VoiceChannelView';
import { MemberList } from '../features/members/MemberList';
import { ServerRail } from '../features/servers/ServerRail';
import { FriendsPanel } from '../features/friends/FriendsPanel';
import { ScrollArea } from '../components/ui/ScrollArea';
import { CallPersonMenu } from '../features/voice/CallPersonMenu';

const DM_ROUTE = 'dm';

/**
 * Whether a failed guild load should send the user home. Only an answer from the server
 * saying this guild is not theirs (403/404) counts; a dropped connection, a timeout or a
 * 5xx used to redirect to `/app`, which looks exactly like being logged out.
 */
export function shouldLeaveGuildOnError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return status === 403 || status === 404;
}

export function AppPage() {
  const { guildId = null, channelId = null } = useParams();
  const currentUser = useAuthStore((state) => state.user);
  const guilds = useChatStore((state) => state.guilds);
  const dms = useChatStore((state) => state.dms);
  const guildDetails = useChatStore((state) => state.guildDetails);
  const bootstrap = useChatStore((state) => state.bootstrap);
  const loadGuild = useChatStore((state) => state.loadGuild);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const memberListOpen = useUiStore((state) => state.memberListOpen);
  const [jumpTarget, setJumpTarget] = useState<{ channelId: string; messageId: string } | null>(null);
  const navigate = useNavigate();
  const requestJump = useCallback((messageId: string) => {
    if (channelId) setJumpTarget({ channelId, messageId });
  }, [channelId]);
  const clearJump = useCallback(() => setJumpTarget(null), []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!guildId || guildId === DM_ROUTE) return;
    void loadGuild(guildId).catch((error: unknown) => {
      // stay on the page for transient failures; the next render or reconnect retries
      if (shouldLeaveGuildOnError(error)) navigate('/app', { replace: true });
    });
  }, [guildId, loadGuild, navigate]);

  useEffect(() => {
    if (!channelId) return;
    // opening the conversation clears its unread counter
    useNotificationStore.getState().markChannelRead(channelId);
    void loadMessages(channelId).catch(() => undefined);
    realtime.subscribe([channelId]);
    return () => realtime.unsubscribe([channelId]);
  }, [channelId, loadMessages]);

  const isDm = guildId === DM_ROUTE;
  const guild = guildId && !isDm ? guildDetails[guildId] : undefined;
  const dm = isDm ? dms.find((item) => item.id === channelId) : undefined;
  const channel = isDm ? dm : guild?.channels.find((item) => item.id === channelId);

  // `/app/:guildId` without a channel: open the first text channel automatically
  const firstGuildChannel = guild?.channels.find((item) => item.type === 'text');
  useEffect(() => {
    if (guildId && !isDm && !channelId && firstGuildChannel) {
      navigate(`/app/${guildId}/${firstGuildChannel.id}`, { replace: true });
    }
  }, [guildId, isDm, channelId, firstGuildChannel, navigate]);

  // voice channels show their own participants, so the guild member list stays hidden there
  const showMemberList = !!guild && memberListOpen && !!channel && channel.type !== 'voice';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-h-0 shrink-0">
          <ServerRail />
          {isDm || !guildId ? <DmSidebar /> : <ChannelSidebar guildId={guildId} />}
          {/* floating dock: anchored to the servers/channels column, never over the chat */}
          <UserDock />
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-chat">
          {channel && !isDm && channel.type === 'voice' && guildId ? (
            <VoiceChannelView guildId={guildId} channel={channel} />
          ) : channel ? (
            <>
              <ChannelHeader
                channel={channel}
                isGuild={!isDm}
                dmWith={dm?.recipients.find((user) => user.id !== currentUser?.id)?.displayName}
                dmUserId={dm?.recipients.find((user) => user.id !== currentUser?.id)?.id}
                onJumpToMessage={requestJump}
              />
              <MessageList
                channelId={channel.id}
                guildId={isDm ? undefined : guildId ?? undefined}
                isDm={isDm}
                jumpToMessageId={jumpTarget?.channelId === channel.id ? jumpTarget.messageId : null}
                onJumpHandled={clearJump}
              />
            </>
          ) : (
            <FriendsHome
              onOpenDm={(id) => navigate(`/app/${DM_ROUTE}/${id}`)}
              hasGuilds={guilds.length > 0}
              friendsView={isDm && !channelId}
            />
          )}
        </main>

        {showMemberList ? <MemberList guildId={guildId ?? ""} /> : null}
      </div>
      <ModalHost />
      {/* right-click menu of a person in a call; mounted once, above every panel */}
      <CallPersonMenu />
    </div>
  );
}

/**
 * Main panel of the DM area: the full friend list when "Amigos" is selected,
 * otherwise the welcome card that leads into a conversation.
 */
function FriendsHome({
  onOpenDm,
  hasGuilds,
  friendsView,
}: {
  onOpenDm: (id: string) => void;
  hasGuilds: boolean;
  friendsView: boolean;
}) {
  return friendsView ? <FriendsView onOpenDm={onOpenDm} /> : <DmHome onOpenDm={onOpenDm} hasGuilds={hasGuilds} />;
}

function FriendsView({ onOpenDm }: { onOpenDm: (id: string) => void }) {
  const openModal = useUiStore((state) => state.openModal);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider px-4">
        <Users size={20} className="text-muted" aria-hidden />
        <h1 className="text-base font-semibold text-heading">Amigos</h1>
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => openModal({ kind: 'add-friend' })}>
          <UserPlus size={14} aria-hidden /> Adicionar amigo
        </Button>
      </header>
      <ScrollArea className="flex-1" viewportClassName="px-4 py-4">
        <div className="mx-auto max-w-[760px] rounded-md bg-sidebar px-3 py-2">
          <FriendsPanel showHeader={false} onOpenChat={onOpenDm} />
        </div>
      </ScrollArea>
    </div>
  );
}

function DmHome({ onOpenDm, hasGuilds }: { onOpenDm: (id: string) => void; hasGuilds: boolean }) {
  const dms = useChatStore((state) => state.dms);
  const guilds = useChatStore((state) => state.guilds);
  const currentUser = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 flex-1 gap-6 p-6">
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-dashed border-divider">
        <EmptyState
          icon={MessageSquarePlus}
          title="Bem-vindo(a) às suas mensagens"
          description={
            <>
              Converse com amigos, envie imagens e reaja às mensagens. Use o botão <strong>+</strong> na barra lateral
              para iniciar uma conversa ou clique em uma existente.
            </>
          }
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => openModal({ kind: 'new-dm' })}>
                <Plus size={16} aria-hidden /> Nova conversa
              </Button>
              {hasGuilds ? (
                <Button variant="secondary" onClick={() => navigate(`/app/${guilds[0]!.id}`)}>
                  Explorar servidores
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => openModal({ kind: 'join-server' })}>
                  Entrar em um servidor
                </Button>
              )}
            </div>
          }
        />
      </div>

      <aside className="hidden w-72 shrink-0 flex-col gap-2 overflow-y-auto xl:flex" aria-label="Conversas recentes">
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Conversas recentes</h2>
        {dms.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma conversa ainda.</p>
        ) : (
          dms.map((dm) => {
            const other = dm.recipients.find((user) => user.id !== currentUser?.id) ?? dm.recipients[0];
            if (!other) return null;
            return (
              <button
                key={dm.id}
                type="button"
                onClick={() => onOpenDm(dm.id)}
                className="rounded-md border border-divider bg-input px-3 py-2 text-left text-sm text-normal transition-colors hover:border-line-strong"
              >
                {other.displayName}
              </button>
            );
          })
        )}
      </aside>
    </div>
  );
}
