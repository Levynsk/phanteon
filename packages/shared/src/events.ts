import type {
  Channel,
  DmChannel,
  FriendsOverview,
  GuildMember,
  GuildSummary,
  GuildBan,
  GuildWithDetails,
  Message,
  PublicUser,
  VoiceState,
  Reaction,
  UserStatus,
} from './entities';

export interface ReactionUpdate {
  channelId: string;
  messageId: string;
  reaction: Reaction;
}

/** Server -> client events sent over the realtime socket. */
export type ServerEvent =
  | { type: 'ready'; userId: string; guildIds: string[]; channelIds: string[] }
  | { type: 'message:create'; message: Message }
  | { type: 'message:update'; message: Message }
  | { type: 'message:delete'; channelId: string; messageId: string }
  | { type: 'reaction:update'; payload: ReactionUpdate }
  | { type: 'typing'; channelId: string; user: PublicUser }
  | { type: 'guild:create'; guild: GuildWithDetails }
  | { type: 'guild:update'; guild: GuildSummary }
  | { type: 'guild:roles'; guildId: string; roles: import('./roles').GuildRoleEntity[] }
  | { type: 'member:roles'; guildId: string; userId: string; roleIds: string[]; position: number }
  | { type: 'guild:delete'; guildId: string }
  | { type: 'channel:create'; channel: Channel }
  | { type: 'channel:update'; channel: Channel }
  | { type: 'channel:delete'; channelId: string; guildId: string }
  | { type: 'member:add'; guildId: string; member: GuildMember }
  | { type: 'member:remove'; guildId: string; userId: string }
  | { type: 'member:update'; guildId: string; userId: string; role: GuildMember['role'] }
  | { type: 'dm:create'; dm: DmChannel }
  | { type: 'user:update'; user: PublicUser }
  | { type: 'presence:update'; userId: string; status: UserStatus; online: boolean }
  | { type: 'voice:state'; state: VoiceState }
  /** All current voice participants, sent once after the socket is ready. */
  | {
      type: 'voice:sync';
      states: VoiceState[];
      /** Who can actually hear whom right now; recapped on every reconnect. */
      audience?: { channelId: string; userId: string }[];
    }
  | { type: 'voice:leave'; guildId: string; channelId: string; userId: string }
  /** Partial voice update (e.g. speaking), sent instead of the whole state. */
  | { type: 'voice:speaking'; guildId: string; channelId: string; userId: string; speaking: boolean }
  /** WebRTC signalling relayed between two users in the same call. */
  | { type: 'rtc:signal'; from: string; channelId: string; data: RtcSignalData }
  /** Full ban list, re-sent to moderators whenever it changes. */
  | { type: 'bans:sync'; guildId: string; bans: GuildBan[] }
  | { type: 'ban:add'; guildId: string; ban: GuildBan }
  | { type: 'ban:remove'; guildId: string; userId: string }
  /** Full friends overview, pushed when a request is sent, accepted or blocked. */
  | { type: 'friends:update'; friends: FriendsOverview };

/** Client -> server events. */
export type ClientEvent =
  /** First frame on a socket: the session token, kept out of the URL. */
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; channelIds: string[] }
  | { type: 'unsubscribe'; channelIds: string[] }
  | { type: 'typing'; channelId: string }
  /** Self mute/deafen; the server broadcasts the authoritative state. */
  | { type: 'voice:update'; selfMute?: boolean; selfDeaf?: boolean }
  | { type: 'voice:speaking'; speaking: boolean }
  | { type: 'rtc:signal'; to: string; channelId: string; data: RtcSignalData }
  | { type: 'ping' };

export type SocketStatus = 'connecting' | 'open' | 'closed';

/** SDP offer/answer or ICE candidate exchanged between call peers. */
export type RtcSignalData =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: unknown }
  /** Announced by the sharer so every peer knows to expect (or expect no) screen tracks. */
  | { kind: 'screen'; active: boolean; audio?: boolean; audioMid?: string };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

/** ICE servers the app must use for every peer connection (STUN and an optional TURN relay). */
export interface IceConfig {
  iceServers: { urls: string[] | string; username?: string; credential?: string }[];
  /** False when the deployment has no TURN: calls then only work peer to peer. */
  relayConfigured: boolean;
}
