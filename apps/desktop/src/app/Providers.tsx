import { useEffect } from 'react';
import { useAuthStore } from './stores/auth';
import { useChatStore } from './stores/chat';
import { useUiStore } from './stores/ui';
import { useNotificationStore } from './stores/notifications';
import { playCue, unlockAudio } from '../lib/sounds';
import { realtime } from '../lib/realtime';
import { onSpeakingMeters } from '../lib/voice-session';

/**
 * Feeds an incoming message to the notification store with the context it needs
 * (guild/channel names, whether the user is looking at that channel right now).
 */
function routeNotifiableMessage(message: { author: { id: string; displayName: string }; channelId: string; content: string }, myId: string) {
  const chat = useChatStore.getState();
  const notifications = useNotificationStore.getState();
  const dm = chat.dms.find((entry) => entry.id === message.channelId);
  // `/app/:guildId/:channelId` or `/app/dm/:channelId` — the channel is the last segment
  const hash = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
  const segments = hash.split('/').filter(Boolean);
  const viewingChannelId = segments[0] === 'app' && segments.length >= 3 ? (segments[2] ?? null) : null;
  const guild = Object.values(chat.guildDetails).find((entry) =>
    entry.channels.some((channel) => channel.id === message.channelId),
  );
  const channel = guild?.channels.find((entry) => entry.id === message.channelId);
  notifications.notifyMessage(message as never, {
    myId,
    guildId: guild?.id ?? null,
    isDm: !!dm,
    channelName: dm ? message.author.displayName : (channel?.name ?? 'canal'),
    guildName: guild?.name ?? null,
    viewingChannelId,
    online: useUiStore.getState().socketStatus === 'open',
  });
}

/**
 * Routes realtime events into the chat store and keeps the socket in sync with
 * the session. Mounted for authenticated views only.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const selfId = useAuthStore((state) => state.user?.id);

  // the chat store needs the signed-in id synchronously (voice mute/deafen logic)
  useEffect(() => {
    useChatStore.setState({ selfUser: selfId ? { id: selfId } : null });
  }, [selfId]);

  useEffect(() => {
    const unsubscribeEvents = realtime.onEvent((event) => {
      const currentUserId = useAuthStore.getState().user?.id ?? '';
      const chat = useChatStore.getState();
      useChatStore.getState().handleEvent(event, currentUserId);
      if (event.type === 'user:update') useAuthStore.getState().applyUserUpdate(event.user);
      if (event.type === 'message:create') routeNotifiableMessage(event.message, currentUserId);
      if (event.type === 'friends:update') {
        const before = chat.friends?.incoming.length ?? 0;
        const after = event.friends.incoming.length;
        if (after > before) {
          const latest = event.friends.incoming.find((entry) => !chat.friends?.incoming.some((old) => old.user.id === entry.user.id));
          if (latest) {
            const notifications = useNotificationStore.getState();
            notifications.notifyEvent(
              { kind: 'friend', title: 'Pedido de amizade', body: `${latest.user.displayName} quer ser seu amigo` },
              notifications.prefs.soundsForMessages ? 'message' : undefined,
            );
          }
        }
      }
    });
    // the first user gesture is what lets the browser play any sound at all
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    // local mic meter -> presence ring for other participants
    onSpeakingMeters(
      (speaking) => {
        const me = useAuthStore.getState().user?.id;
        if (me) useChatStore.setState((s) => ({ speaking: { ...s.speaking, [me]: speaking } }));
        realtime.setSpeaking(speaking);
      },
      (userId, speaking) =>
        useChatStore.setState((s) => ({ speaking: { ...s.speaking, [userId]: speaking } })),
    );

    const unsubscribeStatus = realtime.onStatus((status) => {
      useUiStore.getState().setSocketStatus(status);
      // permissions may have changed while offline: refresh the open guild
      if (status === 'open') {
        for (const guildId of Object.keys(useChatStore.getState().guildDetails)) {
          void useChatStore.getState().refreshGuild(guildId).catch(() => undefined);
        }
      }
    });
    return () => {
      unsubscribeEvents();
      unsubscribeStatus();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      realtime.disconnect();
      return;
    }
    realtime.connect(token);
    return () => realtime.disconnect();
  }, [token]);

  return <>{children}</>;
}
