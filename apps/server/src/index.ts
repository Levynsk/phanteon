import { config } from './config/env';
import { resolveUserFromToken } from './auth/middleware';
import { toPublicUser } from './db/mappers';
import { assertSecureConfig } from './config/guard';
import { AUTH_TIMEOUT_MS } from './realtime/auth-timeout';
import { purgeExpiredData } from './services/retention';
import { MAX_UPLOAD_BYTES } from '@phanteon/shared';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { hub, type SocketData } from './realtime/hub';
import { visibleChannelIds, visibleGuildIds } from './realtime/audience';
import {
  broadcastSpeaking,
  currentCallAudience,
  currentVoiceChannel,
  leaveVoiceOnDisconnect,
  listVoiceStatesForUser,
  updateSelfVoice,
} from './services/voice';
import { db, schema } from './db/client';
import { eq } from 'drizzle-orm';
import { getUserRow } from './services/users';

assertSecureConfig();
migrate();

// voice state lives in the DB but is broadcast by the hub
hub.voiceStates = listVoiceStatesForUser;
hub.voiceAudience = (userId) => {
  const guildIds = db
    .select({ guildId: schema.guildMembers.guildId })
    .from(schema.guildMembers)
    .where(eq(schema.guildMembers.userId, userId))
    .all()
    .map((row) => row.guildId);
  return guildIds.flatMap(currentCallAudience);
};
hub.onVoiceUpdate = (userId, input) => {
  try {
    updateSelfVoice(getUserRow(userId), input);
  } catch {
    // user not in a call or left meanwhile; nothing to broadcast
  }
};
hub.onDisconnect = leaveVoiceOnDisconnect;
hub.onSpeaking = broadcastSpeaking;
hub.channelOfVoiceUser = currentVoiceChannel;
hub.onAuth = async (token) => {
  const user = await resolveUserFromToken(token);
  return user ? toPublicUser(user) : null;
};

const app = createApp();

const server = Bun.serve<SocketData, never>({
  port: config.port,
  idleTimeout: 60,
  // the API only accepts JSON bodies and multipart uploads; the ceiling caps memory per request
  maxRequestBodySize: MAX_UPLOAD_BYTES + 1024 * 1024,
  async fetch(request, bunServer) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      // the token never travels in the URL: the socket authenticates with its first
      // frame, so proxies and history cannot log it
      const upgraded = bunServer.upgrade(request, {
        data: {
          user: null,
          channelIds: new Set<string>(),
          isAlive: true,
          isReady: false,
        },
      });
      if (!upgraded) return new Response('Upgrade failed', { status: 400 });
      return undefined;
    }

    if (url.pathname.startsWith('/uploads/')) {
      return Response.redirect(new URL(`/files/${url.pathname.split('/').pop() ?? ''}`, url).toString(), 301);
    }

    return app.fetch(request, bunServer);
  },
  websocket: {
    async open(socket) {
      // a silent or slow client cannot hold an unauthenticated socket forever
      setTimeout(() => {
        if (!socket.data.user) socket.close(4001, 'Autenticação necessária.');
      }, AUTH_TIMEOUT_MS);
    },
    message(socket, message) {
      hub.handleClientEvent(socket, message);
    },
    close(socket) {
      hub.unregister(socket);
    },
    pong(socket) {
      socket.data.isAlive = true;
    },
  },
});

const heartbeat = setInterval(() => hub.sweepDeadSockets(), 25_000);

// retention: idle invites and unattached uploads are dropped once their purpose has passed
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const purge = () => purgeExpiredData().catch((error) => console.error('[retention]', error));
purge();
const retentionTimer = setInterval(purge, PURGE_INTERVAL_MS);

console.log(`\n  Phanteon server → http://localhost:${server.port}`);
console.log(`  WebSocket            → ws://localhost:${server.port}/ws (autentica no primeiro frame)\n`);

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(retentionTimer);
  server.stop(true);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
