import type {
  Channel,
  DmChannel,
  FriendsOverview,
  GuildMember,
  GuildSummary,
  GuildWithDetails,
  Message,
  PublicUser,
  ServerEvent,
  UserStatus,
  VoiceState,
} from '@phanteon/shared';
import { Permission } from '@phanteon/shared';
import {
  disconnectVoicePeer,
  reconcileVoiceMesh,
  setPlaybackMuted,
  setSelfDeafened,
  setSelfMuted,
  stopVoiceMesh,
  syncVoiceMesh,
} from '../../lib/voice-session';
import { create } from 'zustand';
import { useNotificationStore } from './notifications';
import { api } from '../../lib/api';
import { playCue } from '../../lib/sounds';
import { applyVoicePreference, NO_PREFERENCE } from '../../lib/voice-preference';
import type { VoicePreference } from '../../lib/voice-preference';

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loaded: boolean;
}

export interface TypingEntry {
  user: PublicUser;
  at: number;
}

interface ChatState {
  guilds: GuildSummary[];
  guildDetails: Record<string, GuildWithDetails>;
  dms: DmChannel[];
  /** Friend list, requests and blocks (null until loaded). */
  friends: FriendsOverview | null;
  loadFriends: () => Promise<void>;
  messages: Record<string, ChannelMessages>;
  presence: Record<string, UserStatus>;
  online: Record<string, boolean>;
  /** Voice participants keyed by `${guildId}:${userId}`. */
  voiceStates: Record<string, VoiceState>;
  /** User ids currently speaking in voice (local meter or server event). */
  speaking: Record<string, boolean>;
  /** Guild of the voice call the current user is connected to. */
  myVoice: { guildId: string; channelId: string } | null;
  /** Mic/sound chosen while out of a call, applied when the next join lands. */
  voicePreference: VoicePreference;
  /** Signed-in user id, used to read the local voice state synchronously. */
  selfUser: { id: string } | null;
  joinVoice: (guildId: string, channelId: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  setSelfVoice: (input: { selfMute?: boolean; selfDeaf?: boolean }) => Promise<void>;
  typing: Record<string, TypingEntry[]>;
  bootstrapPromise: Promise<void> | null;

  bootstrap: () => Promise<void>;
  loadGuild: (guildId: string, options?: { refresh?: boolean }) => Promise<void>;
  loadMessages: (channelId: string, options?: { before?: string }) => Promise<void>;
  sendMessage: (
    channelId: string,
    input: { content: string; attachmentIds?: string[]; replyToId?: string | null },
  ) => Promise<Message>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;
  toggleReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  openDm: (userId: string) => Promise<DmChannel>;
  addGuild: (guild: GuildWithDetails) => void;
  removeGuild: (guildId: string) => void;
  setChannelInGuild: (guildId: string, channel: Channel) => void;
  removeChannelFromGuild: (guildId: string, channelId: string) => void;
  removeMemberFromGuild: (guildId: string, userId: string) => void;
  upsertMember: (guildId: string, member: GuildMember) => void;
  refreshGuild: (guildId: string) => Promise<void>;
  setMemberRoles: (guildId: string, userId: string, roleIds: string[]) => void;
  setGuildRoles: (guildId: string, roles: GuildWithDetails['roles']) => void;
  handleEvent: (event: ServerEvent, currentUserId: string) => void;
  clearChannelTyping: (channelId: string, userId: string) => void;
  setGuildPermissions: (guildId: string, permissions: number, isOwner: boolean) => void;
  reset: () => void;
}

/**
 * One pending clear per (channel, user). Every packet re-arms it, so a user who keeps
 * typing stays visible; the previous version keyed the clear on the first packet only.
 */
const TYPING_CLEAR_MS = 6000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleTypingClear(typingTimeoutMs: number, channelId: string, userId: string, onClear: () => void): void {
  const key = `${channelId}:${userId}`;
  const pending = typingTimers.get(key);
  if (pending) clearTimeout(pending);
  typingTimers.set(
    key,
    setTimeout(() => {
      typingTimers.delete(key);
      onClear();
    }, typingTimeoutMs),
  );
}

export function clearTypingTimers(): void {
  for (const timer of typingTimers.values()) clearTimeout(timer);
  typingTimers.clear();
}

const EMPTY_MESSAGES: ChannelMessages = { items: [], hasMore: false, loaded: false };

function mergeMessage(list: Message[], message: Message): Message[] {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) return [...list, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = [...list];
  next[index] = message;
  return next;
}

function sortGuildChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

function sortDms(dms: DmChannel[]): DmChannel[] {
  return [...dms].sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
  );
}

/** User ids seated in one call, derived from the roster the store holds. */
function peerIdsIn(states: Record<string, VoiceState>, channelId: string, selfId: string | undefined): string[] {
  const ids = new Set<string>();
  for (const state of Object.values(states)) {
    if (state.channelId === channelId && state.user.id !== selfId) ids.add(state.user.id);
  }
  return [...ids];
}

const initial = {
  guilds: [] as GuildSummary[],
  guildDetails: {} as Record<string, GuildWithDetails>,
  dms: [] as DmChannel[],
  friends: null as FriendsOverview | null,
  messages: {} as Record<string, ChannelMessages>,
  presence: {} as Record<string, UserStatus>,
  online: {} as Record<string, boolean>,
  voiceStates: {} as Record<string, VoiceState>,
  speaking: {},
  myVoice: null,
  voicePreference: NO_PREFERENCE,
  selfUser: null,
  typing: {} as Record<string, TypingEntry[]>,
  bootstrapPromise: null,
};

/** In-flight message loads keyed by channel + cursor (module scope: not reactive). */
const messageRequests = new Map<string, Promise<void>>();
/** Single in-flight join/leave so rapid clicks cannot race each other. */
let voiceTransition: Promise<void> | null = null;

type SelectableState = Pick<ChatState, 'guildDetails'>;

export function guildOfChannel(state: SelectableState, channelId: string): GuildWithDetails | undefined {
  return Object.values(state.guildDetails).find((guild) =>
    guild.channels.some((channel) => channel.id === channelId),
  );
}

/** Whether the signed-in user holds `flag` on the guild that owns the channel. */
export function canInChannel(state: SelectableState, channelId: string, flag: number): boolean {
  const guild = guildOfChannel(state, channelId);
  return !!guild && (guild.myPermissions & flag) === flag;
}

/** Whether the user holds every flag in the given guild. */
export function canInGuild(guild: GuildWithDetails | undefined, ...flags: number[]): boolean {
  if (!guild) return false;
  if (guild.isOwner) return true;
  return flags.every((flag) => (guild.myPermissions & flag) === flag);
}

/** Effective colour of a member: their top coloured role, else the accent colour. */
export function memberColor(guild: GuildWithDetails | undefined, userId: string, fallback: string): string {
  if (!guild) return fallback;
  const member = guild.members.find((entry) => entry.user.id === userId);
  if (!member) return fallback;
  const top = member.roleIds
    .map((id) => guild.roles.find((role) => role.id === id))
    .find((role) => role && !role.isEveryone && role.color && role.color !== '#99aab5');
  return top?.color ?? fallback;
}

export function isModeratorOfChannel(state: SelectableState, channelId: string, _userId?: string): boolean {
  return canInChannel(state, channelId, Permission.ManageMessages);
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...initial,

  bootstrap: () => {
    // never write state synchronously: callers may invoke this inside effects,
    // and a synchronous set would re-render them in a loop.
    const pending = get().bootstrapPromise;
    if (pending) return pending;
    const promise = (async () => {
      try {
        const [{ guilds }, { dms }, { friends }] = await Promise.all([
          api.guilds.list(),
          api.dms.list(),
          api.friends.list(),
        ]);
        set({ guilds, dms: sortDms(dms), friends });
      } finally {
        set({ bootstrapPromise: null });
      }
    })();
    set({ bootstrapPromise: promise });
    return promise;
  },

  loadGuild: async (guildId, options = {}) => {
    if (!options.refresh && get().guildDetails[guildId]) return;
    const { guild } = await api.guilds.get(guildId);
    set((state) => {
      const presence = { ...state.presence };
      const online = { ...state.online };
      for (const member of guild.members) {
        presence[member.user.id] = member.online ? member.user.status : 'offline';
        online[member.user.id] = member.online;
      }
      return {
        guildDetails: { ...state.guildDetails, [guildId]: guild },
        presence,
        online,
        guilds: state.guilds.some((item) => item.id === guild.id)
          ? state.guilds.map((item) => (item.id === guild.id ? guild : item))
          : [...state.guilds, guild],
      };
    });
  },

  loadMessages: (channelId, options = {}) => {
    const key = `${channelId}:${options.before ?? 'latest'}`;
    const inFlight = messageRequests.get(key);
    if (inFlight) return inFlight;

    const existing = get().messages[channelId];
    if (!options.before && existing?.loaded) return Promise.resolve();
    if (options.before && existing && !existing.hasMore) return Promise.resolve();

    const promise = (async () => {
      try {
        const { messages, hasMore } = await api.channels.messages(channelId, { before: options.before });
        set((state) => {
          const current = state.messages[channelId];
          const merged = options.before ? [...messages, ...(current?.items ?? [])] : messages;
          const seen = new Set<string>();
          const items = merged.filter((message) => {
            if (seen.has(message.id)) return false;
            seen.add(message.id);
            return true;
          });
          return {
            messages: { ...state.messages, [channelId]: { items, hasMore, loaded: true } },
          };
        });
      } finally {
        messageRequests.delete(key);
      }
    })();

    messageRequests.set(key, promise);
    return promise;
  },

  sendMessage: async (channelId, input) => {
    const { message } = await api.channels.sendMessage(channelId, input);
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: {
          ...(state.messages[channelId] ?? EMPTY_MESSAGES),
          items: mergeMessage(state.messages[channelId]?.items ?? [], message),
          loaded: true,
        },
      },
    }));
    return message;
  },

  editMessage: async (messageId, content) => {
    const { message } = await api.channels.editMessage(messageId, content);
    set((state) => ({
      messages: {
        ...state.messages,
        [message.channelId]: {
          ...(state.messages[message.channelId] ?? EMPTY_MESSAGES),
          items: mergeMessage(state.messages[message.channelId]?.items ?? [], message),
        },
      },
    }));
  },

  deleteMessage: async (channelId, messageId) => {
    await api.channels.deleteMessage(messageId);
    get().handleEvent({ type: 'message:delete', channelId, messageId }, '');
  },

  toggleReaction: async (channelId, messageId, emoji) => {
    // optimistic toggle; the server event reconciles the final state
    set((state) => {
      const current = state.messages[channelId] ?? EMPTY_MESSAGES;
      const items = current.items.map((message) => {
        if (message.id !== messageId) return message;
        const reactions = [...message.reactions];
        const index = reactions.findIndex((reaction) => reaction.emoji === emoji);
        if (index === -1) reactions.push({ emoji, count: 1, me: true });
        else {
          const reaction = reactions[index]!;
          const me = !reaction.me;
          const count = reaction.count + (me ? 1 : -1);
          if (count <= 0) reactions.splice(index, 1);
          else reactions[index] = { ...reaction, me, count };
        }
        return { ...message, reactions };
      });
      return { messages: { ...state.messages, [channelId]: { ...current, items } } };
    });
    await api.reactions.toggle(messageId, emoji);
  },

  loadFriends: async () => {
    const { friends } = await api.friends.list();
    set({ friends });
  },

  openDm: async (userId) => {
    const { dm } = await api.dms.open(userId);
    set((state) => ({
      dms: sortDms(
        state.dms.some((item) => item.id === dm.id)
          ? state.dms.map((item) => (item.id === dm.id ? { ...item, ...dm } : item))
          : [...state.dms, dm],
      ),
    }));
    return dm;
  },

  addGuild: (guild) => {
    set((state) => ({
      guilds: state.guilds.some((item) => item.id === guild.id) ? state.guilds : [...state.guilds, guild],
      guildDetails: { ...state.guildDetails, [guild.id]: guild },
      presence: {
        ...state.presence,
        ...Object.fromEntries(guild.members.map((member) => [member.user.id, member.online ? member.user.status : 'offline'])),
      },
    }));
  },

  removeGuild: (guildId) => {
    set((state) => {
      const guildDetails = { ...state.guildDetails };
      const channelIds = guildDetails[guildId]?.channels.map((channel) => channel.id) ?? [];
      delete guildDetails[guildId];
      const messages = { ...state.messages };
      for (const channelId of channelIds) delete messages[channelId];
      return {
        guilds: state.guilds.filter((guild) => guild.id !== guildId),
        guildDetails,
        messages,
      };
    });
  },

  setChannelInGuild: (guildId, channel) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      if (!guild) return state;
      const exists = guild.channels.some((item) => item.id === channel.id);
      return {
        guildDetails: {
          ...state.guildDetails,
          [guildId]: {
            ...guild,
            channels: sortGuildChannels(
              exists ? guild.channels.map((item) => (item.id === channel.id ? channel : item)) : [...guild.channels, channel],
            ),
          },
        },
      };
    });
  },

  removeChannelFromGuild: (guildId, channelId) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      const messages = { ...state.messages };
      delete messages[channelId];
      if (!guild) return { messages };
      return {
        messages,
        guildDetails: {
          ...state.guildDetails,
          [guildId]: { ...guild, channels: guild.channels.filter((channel) => channel.id !== channelId) },
        },
      };
    });
  },

  removeMemberFromGuild: (guildId, userId) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      if (!guild) return state;
      return {
        guildDetails: {
          ...state.guildDetails,
          [guildId]: { ...guild, members: guild.members.filter((member) => member.user.id !== userId) },
        },
      };
    });
  },

  upsertMember: (guildId, member) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      // `member:add` is built from the joiner's own view, where they are not online yet; a live
      // member is by definition connected, so never let the event flip them to offline
      const online = { ...state.online, [member.user.id]: true };
      const resolved: typeof member = { ...member, online: true };
      const presence = { ...state.presence, [member.user.id]: member.user.status };
      if (!guild) return { presence, online };
      const exists = guild.members.some((item) => item.user.id === member.user.id);
      return {
        presence,
        online,
        guildDetails: {
          ...state.guildDetails,
          [guildId]: {
            ...guild,
            members: exists
              ? guild.members.map((item) => (item.user.id === member.user.id ? resolved : item))
              : [...guild.members, resolved],
          },
        },
      };
    });
  },

  refreshGuild: async (guildId) => {
    const { guild } = await api.guilds.get(guildId);
    set((state) => ({
      guildDetails: { ...state.guildDetails, [guildId]: guild },
      guilds: state.guilds.some((item) => item.id === guild.id)
        ? state.guilds.map((item) => (item.id === guild.id ? guild : item))
        : [...state.guilds, guild],
    }));
  },

  setMemberRoles: (guildId, userId, roleIds) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      if (!guild) return state;
      return {
        guildDetails: {
          ...state.guildDetails,
          [guildId]: {
            ...guild,
            members: guild.members.map((member) =>
              member.user.id === userId ? { ...member, roleIds } : member,
            ),
          },
        },
      };
    });
  },

  setGuildRoles: (guildId, roles) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      if (!guild) return state;
      return { guildDetails: { ...state.guildDetails, [guildId]: { ...guild, roles } } };
    });
  },

  joinVoice: async (guildId, channelId) => {
    if (voiceTransition) return voiceTransition;
    const currentVoice = get().myVoice;
    if (currentVoice?.guildId === guildId && currentVoice.channelId === channelId) return;
    voiceTransition = (async () => {
    if (currentVoice) {
      stopVoiceMesh();
      set((s) => {
        const voiceStates = { ...s.voiceStates };
        const selfId = s.selfUser?.id;
        if (selfId) delete voiceStates[`${currentVoice.guildId}:${selfId}`];
        return { voiceStates, myVoice: null, speaking: {} };
      });
      await api.voice.leave(currentVoice.guildId);
    }
    const { state } = await api.voice.join(channelId);
    if (state.channelId !== channelId) return;
    set((s) => ({
      voiceStates: { ...s.voiceStates, [`${guildId}:${state.user.id}`]: state },
      myVoice: { guildId, channelId: state.channelId },
    }));
    // the seat starts unmuted; a mic/sound choice made before the call still holds for this join
    const preference = get().voicePreference;
    if (preference.pending) {
      set({ voicePreference: { ...preference, pending: false } });
      await get()
        .setSelfVoice({ selfMute: preference.selfMute, selfDeaf: preference.selfDeaf })
        .catch(() => undefined);
    }
    const channel = get().guildDetails[guildId]?.channels.find((entry) => entry.id === channelId);
    useNotificationStore.getState().notifyEvent(
      {
        kind: 'call',
        title: 'Entrou na chamada',
        body: channel ? `#${channel.name}` : 'Canal de voz',
        guildId,
        channelId,
      },
      useNotificationStore.getState().prefs.soundsForCalls ? 'join-call' : undefined,
      { action: { label: 'Sair da chamada', onClick: () => void get().leaveVoice() } },
    );
    const current = get();
    await syncVoiceMesh(state.user.id, Object.values(current.voiceStates), channelId);
    })().finally(() => {
      voiceTransition = null;
    });
    return voiceTransition;
  },

  leaveVoice: async () => {
    if (voiceTransition) return voiceTransition;
    const mine = get().myVoice;
    if (!mine) return;
    // drop local state and the mesh before the request so a second click is a no-op
    stopVoiceMesh();
    set({ myVoice: null });
    voiceTransition = (async () => {
    const channel = get().guildDetails[mine.guildId]?.channels.find((entry) => entry.id === mine.channelId);
    useNotificationStore.getState().notifyEvent(
      {
        kind: 'call',
        title: 'Saiu da chamada',
        body: channel ? `#${channel.name}` : 'Canal de voz',
        guildId: mine.guildId,
        channelId: mine.channelId,
      },
      useNotificationStore.getState().prefs.soundsForCalls ? 'leave-call' : undefined,
    );
    await api.voice.leave(mine.guildId).catch(() => undefined);
    })().finally(() => {
      voiceTransition = null;
    });
    return voiceTransition;
  },

  setSelfVoice: async (input) => {
    // out of a call the server has no seat to update: keep the choice for the next join
    if (!get().myVoice) {
      set((s) => ({ voicePreference: applyVoicePreference(s.voicePreference, input) }));
      return;
    }
    const mine = get().myVoice;
    const selfId = get().selfUser?.id;
    const selfState = mine && selfId ? get().voiceStates[`${mine.guildId}:${selfId}`] : undefined;
    // deafen implies mute (Discord semantics); un-muting under deafen is ignored
    const next: { selfMute?: boolean; selfDeaf?: boolean } = { ...input };
    if (input.selfDeaf === true) next.selfMute = true;
    else if (input.selfDeaf === false && (selfState?.selfMute || selfState?.serverMute)) next.selfMute = true;
    else if (input.selfMute === false && (selfState?.selfDeaf || selfState?.serverDeaf)) return;
    const { state } = await api.voice.updateSelf(next);
    // the outgoing track and local playback follow the authoritative server state
    setSelfMuted(state.selfMute || state.serverMute);
    setSelfDeafened(state.selfDeaf || state.serverDeaf);
    set((s) => ({ voiceStates: { ...s.voiceStates, [`${state.guildId}:${state.user.id}`]: state } }));
  },

  setGuildPermissions: (guildId, permissions, isOwner) => {
    set((state) => {
      const guild = state.guildDetails[guildId];
      if (!guild) return state;
      return {
        guildDetails: { ...state.guildDetails, [guildId]: { ...guild, myPermissions: permissions, isOwner } },
      };
    });
  },

  clearChannelTyping: (channelId, userId) => {
    set((state) => {
      const entries = state.typing[channelId];
      // nothing to clear (or every list already dropped): returning the same state avoids
      // recreating records after reset() wiped them
      if (!entries) return state;
      const kept = entries.filter((entry) => entry.user.id !== userId);
      if (kept.length > 0) return { typing: { ...state.typing, [channelId]: kept } };
      // do not leave an empty record behind: after reset() a stale timer would recreate it
      const typing = { ...state.typing };
      delete typing[channelId];
      return { typing };
    });
  },

  handleEvent: (event, currentUserId) => {
    const state = get();
    switch (event.type) {
      case 'message:create': {
        const { message } = event;
        const current = state.messages[message.channelId] ?? EMPTY_MESSAGES;
        set((s) => ({
          messages: {
            ...s.messages,
            [message.channelId]: { ...current, items: mergeMessage(current.items, message) },
          },
          typing: {
            ...s.typing,
            [message.channelId]: (s.typing[message.channelId] ?? []).filter(
              (entry) => entry.user.id !== message.author.id,
            ),
          },
          dms: sortDms(
            s.dms.map((dm) =>
              dm.id === message.channelId ? { ...dm, lastMessageAt: message.createdAt } : dm,
            ),
          ),
        }));
        break;
      }
      case 'message:update': {
        const { message } = event;
        const current = state.messages[message.channelId];
        if (!current) break;
        set((s) => ({
          messages: { ...s.messages, [message.channelId]: { ...current, items: mergeMessage(current.items, message) } },
        }));
        break;
      }
      case 'message:delete': {
        const current = state.messages[event.channelId];
        if (!current) break;
        set((s) => ({
          messages: {
            ...s.messages,
            [event.channelId]: { ...current, items: current.items.filter((m) => m.id !== event.messageId) },
          },
        }));
        break;
      }
      case 'reaction:update': {
        const { channelId, messageId, reaction } = event.payload;
        const current = state.messages[channelId];
        if (!current) break;
        set((s) => ({
          messages: {
            ...s.messages,
            [channelId]: {
              ...current,
              items: current.items.map((message) => {
                if (message.id !== messageId) return message;
                const reactions = message.reactions.filter((item) => item.emoji !== reaction.emoji);
                if (reaction.count > 0) reactions.push(reaction);
                return { ...message, reactions };
              }),
            },
          },
        }));
        break;
      }
      case 'typing': {
        if (event.user.id === currentUserId) break;
        const entries = (state.typing[event.channelId] ?? []).filter((entry) => entry.user.id !== event.user.id);
        set((s) => ({
          typing: { ...s.typing, [event.channelId]: [...entries, { user: event.user, at: Date.now() }] },
        }));
        scheduleTypingClear(TYPING_CLEAR_MS, event.channelId, event.user.id, () =>
          get().clearChannelTyping(event.channelId, event.user.id),
        );
        break;
      }
      case 'guild:create':
        get().addGuild(event.guild);
        break;
      case 'guild:update':
        set((s) => ({
          guilds: s.guilds.map((guild) => (guild.id === event.guild.id ? event.guild : guild)),
          guildDetails: s.guildDetails[event.guild.id]
            ? { ...s.guildDetails, [event.guild.id]: { ...s.guildDetails[event.guild.id]!, ...event.guild } }
            : s.guildDetails,
        }));
        break;
      case 'guild:roles':
        set((s) => {
          const guild = s.guildDetails[event.guildId];
          if (!guild) return s;
          return { guildDetails: { ...s.guildDetails, [event.guildId]: { ...guild, roles: event.roles } } };
        });
        break;
      case 'member:roles':
        set((s) => {
          const guild = s.guildDetails[event.guildId];
          if (!guild) return s;
          return {
            guildDetails: {
              ...s.guildDetails,
              [event.guildId]: {
                ...guild,
                members: guild.members.map((member) =>
                  member.user.id === event.userId
                    ? { ...member, roleIds: event.roleIds, position: event.position }
                    : member,
                ),
              },
            },
          };
        });
        break;
      case 'guild:delete':
        get().removeGuild(event.guildId);
        break;
      case 'channel:create':
        if (event.channel.guildId) get().setChannelInGuild(event.channel.guildId, event.channel);
        break;
      case 'channel:update':
        if (event.channel.guildId) get().setChannelInGuild(event.channel.guildId, event.channel);
        break;
      case 'channel:delete':
        get().removeChannelFromGuild(event.guildId, event.channelId);
        break;
      case 'member:add':
        get().upsertMember(event.guildId, event.member);
        break;
      case 'member:remove':
        get().removeMemberFromGuild(event.guildId, event.userId);
        break;
      case 'member:update': {
        const guild = state.guildDetails[event.guildId];
        if (!guild) break;
        set((s) => ({
          guildDetails: {
            ...s.guildDetails,
            [event.guildId]: {
              ...guild,
              members: guild.members.map((member) =>
                member.user.id === event.userId ? { ...member, role: event.role } : member,
              ),
            },
          },
        }));
        break;
      }
      case 'friends:update':
        set({ friends: event.friends });
        break;
      case 'dm:create':
        set((s) => ({
          dms: sortDms(
            s.dms.some((dm) => dm.id === event.dm.id)
              ? s.dms.map((dm) => (dm.id === event.dm.id ? event.dm : dm))
              : [...s.dms, event.dm],
          ),
        }));
        break;
      case 'user:update':
        set((s) => {
          const guildDetails = Object.fromEntries(
            Object.entries(s.guildDetails).map(([guildId, guild]) => [
              guildId,
              {
                ...guild,
                members: guild.members.map((member) =>
                  member.user.id === event.user.id ? { ...member, user: event.user } : member,
                ),
              },
            ]),
          );
          return {
            guildDetails,
            dms: s.dms.map((dm) => ({
              ...dm,
              recipients: dm.recipients.map((user) => (user.id === event.user.id ? event.user : user)),
            })),
            presence: { ...s.presence, [event.user.id]: s.online[event.user.id] ? event.user.status : 'offline' },
          };
        });
        break;
      case 'presence:update':
        set((s) => ({
          presence: { ...s.presence, [event.userId]: event.status },
          online: { ...s.online, [event.userId]: event.online },
        }));
        break;
      case 'voice:sync':
        set((s) => {
          const voiceStates = Object.fromEntries(
            event.states.map((state) => [`${state.guildId}:${state.user.id}`, state]),
          );
          for (const state of event.states) {
            if (state.user.id === currentUserId) {
              setSelfMuted(state.selfMute || state.serverMute);
              setSelfDeafened(state.selfDeaf || state.serverDeaf);
            } else {
              setPlaybackMuted(state.user.id, state.serverMute || state.serverDeaf || state.selfDeaf);
            }
          }
          // my call survived the reconnect: re-diff the mesh so a peer that left while offline is dropped
          // in a call: re-diff the mesh so a peer that joined or left while offline is fixed up,
          // whether or not this sync happened to carry my own row
          const myChannel = s.myVoice?.channelId;
          if (myChannel) {
            void reconcileVoiceMesh(myChannel, peerIdsIn(voiceStates, myChannel, currentUserId));
          }
          // an omitted row (late commit, reconnect) must not tear down my call:
          // only an explicit voice:leave or the server dropping my own socket ends it
          const mine = event.states.find((state) => state.user.id === currentUserId);
          return {
            voiceStates,
            // fresh roster: forget stale speaking flags
            speaking: {},
            myVoice: mine ? { guildId: mine.guildId, channelId: mine.channelId } : s.myVoice,
          };
        });
        break;
      case 'voice:speaking':
        set((s) => ({ speaking: { ...s.speaking, [event.userId]: event.speaking } }));
        break;
      case 'voice:state': {
        const { state } = event;
        const before = get().voiceStates[`${state.guildId}:${state.user.id}`];
        const mine = get().myVoice;
        if (!before && state.user.id !== currentUserId && mine?.guildId === state.guildId && mine.channelId === state.channelId) {
          const notifications = useNotificationStore.getState();
          if (notifications.prefs.soundsForCalls) playCue('join-call', notifications.prefs.volume);
        }
        if (state.user.id === currentUserId) {
          setSelfMuted(state.selfMute || state.serverMute);
          setSelfDeafened(state.selfDeaf || state.serverDeaf);
        } else {
          // server mute/deafen outranks the peer's own flags: they cannot undo it themselves
          setPlaybackMuted(state.user.id, state.serverMute || state.serverDeaf || state.selfDeaf);
        }
        // someone else joined my call: the mesh must connect to them (and nobody else)
        if (state.user.id !== currentUserId && mine?.channelId === state.channelId) {
          const roster = { ...get().voiceStates, [`${state.guildId}:${state.user.id}`]: state };
          void reconcileVoiceMesh(state.channelId, peerIdsIn(roster, state.channelId, currentUserId));
        }
        set((s) => ({
          voiceStates: { ...s.voiceStates, [`${state.guildId}:${state.user.id}`]: state },
          myVoice:
            state.user.id === currentUserId ? { guildId: state.guildId, channelId: state.channelId } : s.myVoice,
        }));
        break;
      }
      case 'voice:leave': {
        const existing = get().voiceStates[`${event.guildId}:${event.userId}`];
        const mine = get().myVoice;
        const leftActiveCall = !!existing && event.userId !== currentUserId && mine?.guildId === event.guildId && mine.channelId === event.channelId;
        if (leftActiveCall) {
          const notifications = useNotificationStore.getState();
          if (notifications.prefs.soundsForCalls) playCue('leave-call', notifications.prefs.volume);
        }
        set((s) => {
          const voiceStates = { ...s.voiceStates };
          delete voiceStates[`${event.guildId}:${event.userId}`];
          const speaking = { ...s.speaking };
          delete speaking[event.userId];
          const mine = s.myVoice;
          // drop the peer's media right away; a full sync would only trim the roster
          if (event.userId !== currentUserId && mine?.channelId === event.channelId) {
            disconnectVoicePeer(event.userId);
          }
          return {
            voiceStates,
            speaking,
            myVoice:
              mine && mine.guildId === event.guildId && event.userId === currentUserId ? null : s.myVoice,
          };
        });
        break;
      }
      case 'ready':
        break;
    }
  },

  reset: () => {
    messageRequests.clear();
    // a logout must not leave timers writing into the next account's store
    clearTypingTimers();
    set({ ...initial });
  },
}));
