import type {
  ApiErrorBody,
  Attachment,
  IceConfig,
  CreateRoleInput,
  GuildRoleEntity,
  RoleSummary,
  UpdateRoleInput,
  AuthSession,
  Channel,
  AuditLogEntry,
  DmChannel,
  FriendsOverview,
  GuildBan,
  RelationshipKind,
  GuildInvite,
  GuildMember,
  GuildSummary,
  GuildWithDetails,
  Message,
  PublicUser,
  Reaction,
  UserStatus,
  VoiceState,
} from '@phanteon/shared';
import { getApiUrl } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Algo deu errado.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code ?? 'INTERNAL';
    this.details = body.error?.details;
  }
}

export interface GuildPatch {
  name?: string;
  description?: string | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  iconColor?: string;
}

export interface CategoryInput {
  name: string;
  visibility?: 'public' | 'private';
  roleIds?: string[];
}

export interface ChannelAccessInput {
  visibility?: 'public' | 'private';
  roleIds?: string[];
  categoryId?: string | null;
  name?: string;
  topic?: string | null;
  userLimit?: number;
}

type TokenProvider = () => string | null;
type UnauthorizedHandler = () => void;

let getToken: TokenProvider = () => null;
let onUnauthorized: UnauthorizedHandler = () => undefined;

/** The current session token, for URLs that cannot send an `Authorization` header (images, media). */
export function currentToken(): string | null {
  return getToken();
}

export function configureApi(options: { getToken: TokenProvider; onUnauthorized: UnauthorizedHandler }) {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api${path}`, getApiUrl());
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    // direct: the API answers `file://` with `Access-Control-Allow-Origin`. Routing
    // through `remote://` breaks POSTs, whose preflight the protocol handler never sees.
    response = await fetch(url, { method: options.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, {
      error: { code: 'INTERNAL', message: 'Servidor indisponível. Verifique se o backend está rodando.' },
    });
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => ({}))) as T | ApiErrorBody;
  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) onUnauthorized();
    throw new ApiError(response.status, payload as ApiErrorBody);
  }
  return payload as T;
}

export const api = {
  auth: {
    register: (input: { username: string; displayName?: string; email: string; password: string }) =>
      request<AuthSession>('/auth/register', { method: 'POST', body: input, auth: false }),
    login: (input: { identifier: string; password: string }) =>
      request<AuthSession>('/auth/login', { method: 'POST', body: input, auth: false }),
    me: () => request<{ user: PublicUser }>('/auth/me'),
  },

  unfurl: (url: string) =>
    request<{
      embed: {
        url: string;
        siteName: string;
        title: string;
        description: string | null;
        image: string | null;
        color: string;
      };
    }>('/unfurl', { query: { url } }),

  friends: {
    list: () => request<{ friends: FriendsOverview }>('/friends'),
    kind: (userId: string) => request<{ relationship: RelationshipKind | null }>(`/friends/${userId}`),
    request: (userId: string) => request<{ friends: FriendsOverview }>(`/friends/${userId}`, { method: 'POST' }),
    accept: (userId: string) =>
      request<{ friends: FriendsOverview }>(`/friends/${userId}/accept`, { method: 'POST' }),
    /** Declines an incoming request or cancels an outgoing one. */
    decline: (userId: string) =>
      request<{ friends: FriendsOverview }>(`/friends/${userId}/request`, { method: 'DELETE' }),
    remove: (userId: string) => request<{ friends: FriendsOverview }>(`/friends/${userId}`, { method: 'DELETE' }),
    block: (userId: string) =>
      request<{ friends: FriendsOverview }>(`/friends/${userId}/block`, { method: 'PUT' }),
    unblock: (userId: string) =>
      request<{ friends: FriendsOverview }>(`/friends/${userId}/block`, { method: 'DELETE' }),
  },

  users: {
    search: (query: string) => request<{ users: PublicUser[] }>('/users', { query: { q: query } }),
    get: (userId: string) => request<{ user: PublicUser }>(`/users/${userId}`),
    updateMe: (input: {
      displayName?: string;
      status?: UserStatus;
      accentColor?: string;
      avatarUrl?: string | null;
      bannerUrl?: string | null;
      bio?: string | null;
    }) => request<{ user: PublicUser }>('/users/@me', { method: 'PATCH', body: input }),
    profile: (userId: string) => request<{ member: GuildMember | null }>(`/members/${userId}`),
  },

  guilds: {
    list: () => request<{ guilds: GuildSummary[] }>('/guilds'),
    get: (guildId: string) => request<{ guild: GuildWithDetails }>(`/guilds/${guildId}`),
    create: (input: { name: string }) =>
      request<{ guild: GuildWithDetails }>('/guilds', { method: 'POST', body: input }),
    update: (guildId: string, input: GuildPatch) =>
      request<{ guild: GuildSummary }>(`/guilds/${guildId}`, { method: 'PATCH', body: input }),
    remove: (guildId: string) => request<void>(`/guilds/${guildId}`, { method: 'DELETE' }),
    leave: (guildId: string) => request<void>(`/guilds/${guildId}/leave`, { method: 'POST' }),
    createChannel: (
      guildId: string,
      input: { name: string; type?: 'text' | 'voice'; topic?: string; categoryId?: string | null },
    ) => request<{ channel: Channel }>(`/guilds/${guildId}/channels`, { method: 'POST', body: input }),
    categories: (guildId: string) =>
      request<{ categories: Channel[]; roles: GuildRoleEntity[] }>(`/guilds/${guildId}/categories`),
    createCategory: (guildId: string, input: CategoryInput) =>
      request<{ channel: Channel }>(`/guilds/${guildId}/categories`, { method: 'POST', body: input }),
    updateCategory: (guildId: string, categoryId: string, input: Partial<CategoryInput>) =>
      request<{ channel: Channel }>(`/guilds/${guildId}/categories/${categoryId}`, { method: 'PATCH', body: input }),
    removeCategory: (guildId: string, categoryId: string) =>
      request<void>(`/guilds/${guildId}/categories/${categoryId}`, { method: 'DELETE' }),
    syncCategoryPermissions: (guildId: string, categoryId: string) =>
      request<{ channels: Channel[] }>(`/guilds/${guildId}/categories/${categoryId}/sync-permissions`, {
        method: 'POST',
      }),
    reorderChannels: (guildId: string, items: { id: string; categoryId: string | null }[]) =>
      request<{ channels: Channel[] }>(`/guilds/${guildId}/channels/order`, { method: 'PUT', body: { items } }),
    createInvite: (guildId: string, input: { maxUses?: number; durationMs?: number | null } = {}) =>
      request<{ invite: GuildInvite }>(`/guilds/${guildId}/invites`, { method: 'POST', body: input }),
    listInvites: (guildId: string) => request<{ invites: GuildInvite[] }>(`/guilds/${guildId}/invites`),
    revokeInvite: (code: string) => request<void>(`/invites/${code}`, { method: 'DELETE' }),
    join: (code: string) =>
      request<{ guild: GuildWithDetails }>('/guilds/join', { method: 'POST', body: { code } }),
    removeMember: (guildId: string, userId: string) =>
      request<void>(`/guilds/${guildId}/members/${userId}`, { method: 'DELETE' }),
    auditLogs: (guildId: string, query: { action?: string; targetId?: string; before?: string; limit?: number } = {}) =>
      request<{ entries: AuditLogEntry[]; nextCursor: string | null; total: number }>(
        `/guilds/${guildId}/audit-logs`,
        { query: query as Record<string, string | number | undefined> },
      ),
    auditActions: (guildId: string) => request<{ actions: Record<string, string> }>(`/guilds/${guildId}/audit-actions`),
    listBans: (guildId: string) => request<{ bans: GuildBan[] }>(`/guilds/${guildId}/bans`),
    ban: (guildId: string, userId: string, input: { reason?: string | null; durationMs?: number | null }) =>
      request<{ ban: GuildBan }>(`/guilds/${guildId}/bans/${userId}`, { method: 'PUT', body: input }),
    unban: (guildId: string, userId: string) =>
      request<void>(`/guilds/${guildId}/bans/${userId}`, { method: 'DELETE' }),
    uploadImage: (guildId: string, kind: 'icon' | 'banner', file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<{ guild: GuildSummary; url: string }>(`/guilds/${guildId}/images/${kind}`, {
        method: 'POST',
        formData,
      });
    },
  },

  roles: {
    list: (guildId: string) => request<{ roles: RoleSummary[] }>(`/guilds/${guildId}/roles`),
    create: (guildId: string, input: CreateRoleInput) =>
      request<{ role: GuildRoleEntity }>(`/guilds/${guildId}/roles`, { method: 'POST', body: input }),
    update: (guildId: string, roleId: string, input: UpdateRoleInput) =>
      request<{ role: GuildRoleEntity }>(`/guilds/${guildId}/roles/${roleId}`, { method: 'PATCH', body: input }),
    remove: (guildId: string, roleId: string) =>
      request<void>(`/guilds/${guildId}/roles/${roleId}`, { method: 'DELETE' }),
    reorder: (guildId: string, roleIds: string[]) =>
      request<{ roles: GuildRoleEntity[] }>(`/guilds/${guildId}/roles/order`, { method: 'PUT', body: { roleIds } }),
    setMemberRoles: (guildId: string, userId: string, roleIds: string[]) =>
      request<{ roleIds: string[] }>(`/guilds/${guildId}/member-roles/${userId}/roles`, {
        method: 'PUT',
        body: { roleIds },
      }),
  },

  channels: {
    get: (channelId: string) => request<{ channel: Channel }>(`/channels/${channelId}`),
    update: (
      channelId: string,
      input: {
        name?: string;
        topic?: string | null;
        userLimit?: number;
        overrides?: { roleId: string; allow: number; deny: number }[];
      },
    ) => request<{ channel: Channel }>(`/channels/${channelId}`, { method: 'PATCH', body: input }),
    overrides: (channelId: string) =>
      request<{ channel: Channel; overrides: { roleId: string; allow: number; deny: number }[] }>(
        `/channels/${channelId}`,
      ),
    remove: (channelId: string) => request<void>(`/channels/${channelId}`, { method: 'DELETE' }),
    updateAccess: (channelId: string, input: ChannelAccessInput) =>
      request<{ channel: Channel }>(`/channels/${channelId}/access`, { method: 'PUT', body: input }),
    syncPermissions: (channelId: string) =>
      request<{ channels: Channel[] }>(`/channels/${channelId}/sync-permissions`, { method: 'POST' }),
    messages: (channelId: string, options: { before?: string; limit?: number } = {}) =>
      request<{ messages: Message[]; hasMore: boolean }>(`/channels/${channelId}/messages`, { query: options }),
    sendMessage: (
      channelId: string,
      input: { content: string; attachmentIds?: string[]; replyToId?: string | null },
    ) =>
      request<{ message: Message }>(`/channels/${channelId}/messages`, { method: 'POST', body: input }),
    editMessage: (messageId: string, content: string) =>
      request<{ message: Message }>(`/channels/messages/${messageId}`, { method: 'PATCH', body: { content } }),
    deleteMessage: (messageId: string) =>
      request<{ channelId: string; messageId: string }>(`/channels/messages/${messageId}`, { method: 'DELETE' }),
    typing: (channelId: string) => request<void>(`/channels/${channelId}/typing`, { method: 'POST' }),
  },

  voice: {
    mine: () => request<{ states: VoiceState[] }>('/voice'),
    ice: () => request<IceConfig>('/voice/ice'),
    join: (channelId: string) => request<{ state: VoiceState }>(`/voice/channels/${channelId}/join`, { method: 'POST' }),
    leave: (guildId: string) => request<void>(`/voice/guilds/${guildId}/leave`, { method: 'POST' }),
    updateSelf: (input: { selfMute?: boolean; selfDeaf?: boolean }) =>
      request<{ state: VoiceState }>('/voice/@me', { method: 'PATCH', body: input }),
    moderate: (guildId: string, userId: string, action: 'serverMute' | 'serverDeaf' | 'disconnect') =>
      request<void>(`/voice/guilds/${guildId}/members/${userId}`, { method: 'PATCH', body: { action } }),
  },

  reactions: {
    toggle: (messageId: string, emoji: string) =>
      request<{ channelId: string; messageId: string; reaction: Reaction }>(`/messages/${messageId}`, {
        method: 'PUT',
        body: { emoji },
      }),
  },

  dms: {
    list: () => request<{ dms: DmChannel[] }>('/dms'),
    open: (userId: string) => request<{ dm: DmChannel }>('/dms', { method: 'POST', body: { userId } }),
    /** Existing DM with a user, without creating one. */
    with: (userId: string) => request<{ channelId: string | null }>(`/dms/with/${userId}`),
  },

  uploads: {
    upload: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return request<{ attachment: Attachment }>('/uploads', { method: 'POST', formData });
    },
  },
};
