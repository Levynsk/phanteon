import type { ServerWebSocket } from 'bun';
import type { ClientEvent, PublicUser, ServerEvent, VoiceState } from '@phanteon/shared';
import { guildMemberIds, messageAudience, visibleChannelIds, visibleGuildIds } from './audience';

export interface SocketData {
  /** null until the socket authenticates; see `authenticate`. */
  user: PublicUser | null;
  channelIds: Set<string>;
  isAlive: boolean;
  /** listed as ready once per socket */
  isReady: boolean;
}

export type HubSocket = ServerWebSocket<SocketData>;

type EmitOptions = { except?: string[] };

/**
 * Signalling is only relayed when both sides sit in the claimed voice channel:
 * this stops an outsider (or someone in another call) from injecting offers
 * into a conversation they are not part of.
 */
export function canRelaySignal(
  channelOf: (userId: string) => string | null,
  senderId: string,
  targetId: string,
  channelId: string,
): boolean {
  if (!senderId || !targetId || senderId === targetId) return false;
  const senderChannel = channelOf(senderId);
  if (!senderChannel || senderChannel !== channelId) return false;
  return channelOf(targetId) === channelId;
}

class RealtimeHub {
  private readonly sockets = new Map<string, Set<HubSocket>>();
  private readonly channelRooms = new Map<string, Set<HubSocket>>();
  private readonly lastTypingAt = new Map<string, number>();

  /** Verifies a socket token; wired by the entrypoint so the hub never imports auth. */
  onAuth: ((token: string) => Promise<PublicUser | null>) | null = null;

  private authenticateWithToken(socket: HubSocket, token: string): void {
    if (!this.onAuth || typeof token !== 'string' || token.length === 0) {
      socket.close(4001, 'Autenticação necessária.');
      return;
    }
    this.onAuth(token).then(
      (user) => {
        if (!user) {
          socket.close(4001, 'Sessão inválida.');
          return;
        }
        this.authenticate(socket, user);
      },
      () => socket.close(4001, 'Sessão inválida.'),
    );
  }

  /** Wired by the server entrypoint so the hub itself never imports the DB. */
  voiceStates: (userId: string) => VoiceState[] = () => [];
  voiceAudience: (userId: string) => { channelId: string; userId: string }[] = () => [];
  onVoiceUpdate: ((userId: string, input: { selfMute?: boolean; selfDeaf?: boolean }) => void) | null = null;
  onDisconnect: ((userId: string) => void) | null = null;
  onSpeaking: ((userId: string, speaking: boolean) => void) | null = null;
  /** Returns the channel id the user is currently in, or null. Used to gate signalling. */
  channelOfVoiceUser: (userId: string) => string | null = () => null;

  /**
   * Turns an anonymous socket into a user socket. Runs after the token is
   * verified, so a socket that never authenticates owns no rooms at all.
   */
  authenticate(socket: HubSocket, user: PublicUser): boolean {
    if (socket.data.user) return false;
    socket.data.user = user;
    this.register(socket, visibleGuildIds(user.id), visibleChannelIds(user.id));
    return true;
  }

  register(socket: HubSocket, guildIds: string[], channelIds: string[]): void {
    const user = socket.data.user;
    if (!user) return;
    const wasOnline = this.isUserOnline(user.id);

    let userSockets = this.sockets.get(user.id);
    if (!userSockets) {
      userSockets = new Set();
      this.sockets.set(user.id, userSockets);
    }
    userSockets.add(socket);

    socket.subscribe(`user:${user.id}`);
    for (const channelId of channelIds) this.subscribe(socket, channelId);

    if (!socket.data.isReady) {
      socket.data.isReady = true;
      this.send(socket, {
        type: 'ready',
        userId: user.id,
        guildIds,
        channelIds: [...socket.data.channelIds],
      });
    }

    if (!wasOnline) {
      this.broadcastPresence(user, true);
    }
    // whichever socket connects first gets the current call layout
    this.send(socket, {
      type: 'voice:sync',
      states: this.voiceStates(user.id),
      audience: this.voiceAudience(user.id),
    });
  }


  unregister(socket: HubSocket): void {
    this.unsubscribeAll(socket);
    const user = socket.data.user;
    if (!user) return;
    const userSockets = this.sockets.get(user.id);
    userSockets?.delete(socket);
    if (userSockets && userSockets.size === 0) {
      this.sockets.delete(user.id);
      this.broadcastPresence(user, false);
      this.onDisconnect?.(user.id);
    }
  }

  /** Re-evaluates which channels the user may see and syncs their sockets. */
  syncUserRooms(userId: string): void {
    const sockets = this.sockets.get(userId);
    if (!sockets) return;
    const visible = new Set(visibleChannelIds(userId));
    for (const socket of sockets) {
      for (const channelId of [...socket.data.channelIds]) {
        if (!visible.has(channelId)) this.unsubscribe(socket, channelId);
      }
    }
  }

  syncUserRoomsForGuild(guildId: string): void {
    for (const userId of guildMemberIds(guildId)) this.syncUserRooms(userId);
  }

  subscribe(socket: HubSocket, channelId: string): void {
    socket.data.channelIds.add(channelId);
    socket.subscribe(`channel:${channelId}`);
    let room = this.channelRooms.get(channelId);
    if (!room) {
      room = new Set();
      this.channelRooms.set(channelId, room);
    }
    room.add(socket);
  }

  unsubscribe(socket: HubSocket, channelId: string): void {
    socket.data.channelIds.delete(channelId);
    socket.unsubscribe(`channel:${channelId}`);
    this.channelRooms.get(channelId)?.delete(socket);
  }

  unsubscribeAll(socket: HubSocket): void {
    for (const channelId of [...socket.data.channelIds]) this.unsubscribe(socket, channelId);
  }

  isUserOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  onlineUserIds(): string[] {
    return [...this.sockets.keys()];
  }

  /** Sends an event to every member of the given guilds / users. */
  emitToUsers(userIds: Iterable<string>, event: ServerEvent, options: EmitOptions = {}): void {
    const delivered = new Set<HubSocket>();
    for (const userId of userIds) {
      for (const socket of this.sockets.get(userId) ?? []) {
        if (delivered.has(socket)) continue;
        if (options.except?.includes(socket.data.user?.id ?? '')) continue;
        delivered.add(socket);
        this.send(socket, event);
      }
    }
  }

  emitToChannels(channelIds: Iterable<string>, event: ServerEvent, options: EmitOptions = {}): void {
    const delivered = new Set<HubSocket>();
    for (const channelId of channelIds) {
      for (const socket of this.channelRooms.get(channelId) ?? []) {
        if (delivered.has(socket)) continue;
        if (options.except?.includes(socket.data.user?.id ?? '')) continue;
        delivered.add(socket);
        this.send(socket, event);
      }
    }
  }

  emitToChannel(channelId: string, event: ServerEvent, options: EmitOptions = {}): void {
    this.emitToChannels([channelId], event, options);
  }

  emitTyping(channelId: string, sender: PublicUser, audience: string[]): void {
    const key = `${sender.id}:${channelId}`;
    const now = Date.now();
    if (now - (this.lastTypingAt.get(key) ?? 0) < 2500) return;
    this.lastTypingAt.set(key, now);
    this.emitToUsers(audience, { type: 'typing', channelId, user: sender }, { except: [sender.id] });
  }

  handleClientEvent(socket: HubSocket, raw: string | Buffer): void {
    let event: ClientEvent;
    try {
      event = JSON.parse(raw.toString()) as ClientEvent;
    } catch {
      return;
    }

    // an anonymous socket may only try to authenticate (or ping)
    if (!socket.data.user) {
      if (event.type === 'auth') this.authenticateWithToken(socket, event.token);
      return;
    }

    switch (event.type) {
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'subscribe': {
        const visible = new Set(visibleChannelIds(socket.data.user.id));
        for (const channelId of event.channelIds ?? []) {
          if (visible.has(channelId)) this.subscribe(socket, channelId);
        }
        break;
      }
      case 'unsubscribe':
        for (const channelId of event.channelIds ?? []) this.unsubscribe(socket, channelId);
        break;
      case 'typing':
        if (socket.data.channelIds.has(event.channelId)) {
          this.emitTyping(event.channelId, socket.data.user, messageAudience(event.channelId));
        }
        break;
      case 'voice:update':
        this.onVoiceUpdate?.(socket.data.user.id, {
          selfMute: event.selfMute,
          selfDeaf: event.selfDeaf,
        });
        break;
      case 'voice:speaking':
        this.onSpeaking?.(socket.data.user.id, !!event.speaking);
        break;
      case 'rtc:signal': {
        if (!canRelaySignal(this.channelOfVoiceUser, socket.data.user.id, event.to, event.channelId)) break;
        this.emitToUsers([event.to], {
          type: 'rtc:signal',
          from: socket.data.user.id,
          channelId: event.channelId,
          data: event.data,
        });
        break;
      }
      default:
        break;
    }
  }

  sweepDeadSockets(): void {
    for (const sockets of this.sockets.values()) {
      for (const socket of sockets) {
        if (socket.data.isAlive === false) {
          socket.terminate();
          continue;
        }
        socket.data.isAlive = false;
        socket.ping();
      }
    }
  }

  private broadcastPresence(user: PublicUser, online: boolean): void {
    this.emitToUsers([user.id, ...this.peersOf(user.id)], {
      type: 'presence:update',
      userId: user.id,
      status: online ? user.status : 'offline',
      online,
    });
  }

  announcePresence(user: PublicUser): void {
    const online = this.isUserOnline(user.id);
    this.broadcastPresence(user, online);
  }

  disconnectUser(userId: string): void {
    const sockets = this.sockets.get(userId);
    if (!sockets) return;
    for (const socket of [...sockets]) socket.close(4001, 'signed out');
    this.sockets.delete(userId);
  }

  private peersOf(userId: string): string[] {
    const peers = new Set<string>();
    for (const socket of this.channelRooms.values()) {
      for (const peer of socket) {
        const peerId = peer.data.user?.id;
        if (peerId && peerId !== userId) peers.add(peerId);
      }
    }
    return [...peers];
  }

  private send(socket: HubSocket, event: ServerEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // socket closing; ignore
    }
  }
}

export const hub = new RealtimeHub();
