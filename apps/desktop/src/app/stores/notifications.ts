import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Message } from '@phanteon/shared';
import { playCue, type SoundCue } from '../../lib/sounds';
import { toast, type ToastOptions } from '../../components/ui/Toast';

export interface NotificationItem {
  id: string;
  kind: 'message' | 'mention' | 'dm' | 'call' | 'friend' | 'server';
  title: string;
  body: string;
  /** Where clicking should take the user. */
  guildId?: string | null;
  channelId?: string | null;
  createdAt: string;
  read: boolean;
}

export interface NotificationPrefs {
  enabled: boolean;
  volume: number;
  /** Play sounds for ordinary channel messages (mentions and DMs always play when enabled). */
  soundsForMessages: boolean;
  soundsForCalls: boolean;
  /** Show an OS notification when the window is not focused. */
  desktop: boolean;
  /** Also show the OS notification while the app is focused. */
  showWhenFocused: boolean;
  /** Guild ids with every notification turned off. */
  mutedGuilds: string[];
  /** Channel ids with notifications turned off. */
  mutedChannels: string[];
}

interface NotificationState {
  prefs: NotificationPrefs;
  items: NotificationItem[];
  /** Unread counter per channel, used by the sidebar dots. */
  unread: Record<string, number>;
  setPrefs: (patch: Partial<NotificationPrefs>) => void;
  toggleMutedGuild: (guildId: string) => void;
  toggleMutedChannel: (channelId: string) => void;
  push: (item: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => void;
  /** Called when a message arrives over the socket. */
  notifyMessage: (message: Message, context: { myId: string; guildId: string | null; isDm: boolean; channelName: string; guildName?: string | null; viewingChannelId: string | null; online: boolean }) => void;
  notifyEvent: (
    item: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>,
    cue?: SoundCue,
    toastOptions?: ToastOptions,
  ) => void;
  markChannelRead: (channelId: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  volume: 0.6,
  soundsForMessages: true,
  soundsForCalls: true,
  desktop: true,
  showWhenFocused: false,
  mutedGuilds: [],
  mutedChannels: [],
};

/** Five minutes of history is plenty for the bell panel. */
const MAX_ITEMS = 60;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

function isFocused(): boolean {
  return typeof document !== 'undefined' && document.hasFocus() && document.visibilityState === 'visible';
}

function showDesktopNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body, silent: true });
    notification.onclick = () => window.focus();
  } catch {
    // some platforms refuse notifications outside a service worker; the bell still works
  }
}

export async function requestDesktopPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** `@nome`, `<@id>`-style mentions or the author name all count as a mention. */
function mentionsMe(content: string, myId: string, username?: string): boolean {
  if (!content) return false;
  if (content.includes(`<@${myId}>`) || content.includes(`<@!${myId}>`)) return true;
  if (username && content.toLowerCase().includes(`@${username.toLowerCase()}`)) return true;
  return false;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      prefs: DEFAULT_PREFS,
      items: [],
      unread: {},

      setPrefs: (patch) =>
        set((state) => {
          const prefs = { ...state.prefs, ...patch };
          return { prefs };
        }),

      toggleMutedGuild: (guildId) =>
        set((state) => ({
          prefs: {
            ...state.prefs,
            mutedGuilds: state.prefs.mutedGuilds.includes(guildId)
              ? state.prefs.mutedGuilds.filter((id) => id !== guildId)
              : [...state.prefs.mutedGuilds, guildId],
          },
        })),

      toggleMutedChannel: (channelId) =>
        set((state) => ({
          prefs: {
            ...state.prefs,
            mutedChannels: state.prefs.mutedChannels.includes(channelId)
              ? state.prefs.mutedChannels.filter((id) => id !== channelId)
              : [...state.prefs.mutedChannels, channelId],
          },
        })),

      push: (item) =>
        set((state) => ({
          items: [{ ...item, id: nextId(), createdAt: new Date().toISOString(), read: false }, ...state.items].slice(
            0,
            MAX_ITEMS,
          ),
        })),

      notifyMessage: (message, context) => {
        const { prefs, unread } = get();
        const { myId, guildId, isDm, channelName, guildName, viewingChannelId, online } = context;
        if (!online || message.author.id === myId) return;
        if (guildId && prefs.mutedGuilds.includes(guildId)) return;
        if (prefs.mutedChannels.includes(message.channelId)) return;
        if (viewingChannelId === message.channelId && isFocused()) return;

        const mentioned = mentionsMe(message.content, myId);
        const important = isDm || mentioned;

        set({
          unread: { ...unread, [message.channelId]: (unread[message.channelId] ?? 0) + 1 },
        });

        if (!prefs.enabled) return;

        const cue: SoundCue | null = important ? (isDm ? 'dm' : 'mention') : prefs.soundsForMessages ? 'message' : null;
        if (cue) playCue(cue, prefs.volume);

        if (prefs.desktop && (!isFocused() || prefs.showWhenFocused)) {
          showDesktopNotification(message.author.displayName, message.content || 'Enviou um anexo');
        }

        get().push({
          kind: mentioned ? 'mention' : isDm ? 'dm' : 'message',
          title: isDm
            ? message.author.displayName
            : `#${channelName}${guildName ? ` · ${guildName}` : ''}`,
          body: `${message.author.displayName}: ${message.content || 'Enviou um anexo'}`.slice(0, 200),
          guildId,
          channelId: message.channelId,
        });
      },

      notifyEvent: (item, cue, toastOptions) => {
        const { prefs } = get();
        if (!prefs.enabled) {
          // an action toast (e.g. "leave call") must still appear: it is the only way back
          if (toastOptions?.action) toast.info(item.title, item.body, toastOptions);
          return;
        }
        if (cue) playCue(cue, prefs.volume);
        if (prefs.desktop && (!isFocused() || prefs.showWhenFocused)) showDesktopNotification(item.title, item.body);
        get().push(item);
        if (toastOptions?.action) toast.info(item.title, item.body, toastOptions);
      },

      markChannelRead: (channelId) =>
        set((state) => {
          const unread = { ...state.unread };
          delete unread[channelId];
          return { unread };
        }),

      markAllRead: () => set((state) => ({ unread: {}, items: state.items.map((item) => ({ ...item, read: true })) })),

      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),

      clear: () => set({ items: [], unread: {} }),
    }),
    {
      name: 'phanteon-notifications',
      // history and unread counters are per session; only the preferences persist
      partialize: (state) => ({ prefs: state.prefs }) as unknown as NotificationState,
    },
  ),
);
