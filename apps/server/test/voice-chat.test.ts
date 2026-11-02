import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';
import type { SocketData } from '../src/realtime/hub';

/**
 * The voice channel page shows a chat of its own, so a voice channel must hold
 * and serve messages like any other channel instead of borrowing a text one.
 */
useTempDataDir();

const helpers = await import('./helpers');
const { migrate } = await import('../src/db/migrate');
const { hub } = await import('../src/realtime/hub');
const { resolveUserFromToken } = await import('../src/auth/middleware');
const { toPublicUser } = await import('../src/db/mappers');
const { AUTH_TIMEOUT_MS } = await import('../src/realtime/auth-timeout');

hub.onAuth = async (token) => {
  const user = await resolveUserFromToken(token);
  return user ? toPublicUser(user) : null;
};

let server: { port: number; stop: (force?: boolean) => void };

beforeAll(() => {
  migrate();
  server = Bun.serve<SocketData, never>({
    port: 0,
    fetch(request, bunServer) {
      if (new URL(request.url).pathname !== '/ws') return new Response('nope', { status: 404 });
      const upgraded = bunServer.upgrade(request, {
        data: { user: null, channelIds: new Set<string>(), isAlive: true, isReady: false },
      });
      return upgraded ? undefined : new Response('upgrade failed', { status: 400 });
    },
    websocket: {
      open(socket) {
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
    },
  });
});

afterAll(() => server.stop(true));

const { createApp } = await import('../src/app');
const client = helpers.createClient(createApp());

function nextMessage(socket: WebSocket, type: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ${type}`)), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data));
      if (parsed.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function connect(token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${server.port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const ready = nextMessage(socket, 'ready');
  socket.send(JSON.stringify({ type: 'auth', token }));
  await ready;
  return socket;
}

describe('voice channel chat', () => {
  test('stores messages in the voice channel itself and not in the text channel', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, owner);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    const textChannel = (await helpers.guildChannels(client, owner.token, guildId)).find(
      (channel) => channel.type === 'text',
    )!;

    const sent = await client.call('POST', `/api/channels/${voiceId}/messages`, {
      token: owner.token,
      body: { content: 'fala pessoal' },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.message.channelId).toBe(voiceId);

    const voicePage = await client.call('GET', `/api/channels/${voiceId}/messages`, { token: owner.token });
    expect(voicePage.status).toBe(200);
    expect(voicePage.body.messages.map((message: { content: string }) => message.content)).toEqual(['fala pessoal']);

    // the text channel stays empty: the two chats are independent
    const textPage = await client.call('GET', `/api/channels/${textChannel.id}/messages`, { token: owner.token });
    expect(textPage.status).toBe(200);
    expect(textPage.body.messages).toEqual([]);
  });

  test('delivers voice chat messages and typing to subscribed guild members', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    const socket = await connect(member.token);

    try {
      const receivedMessage = nextMessage(socket, 'message:create');
      const sent = await client.call('POST', `/api/channels/${voiceId}/messages`, {
        token: owner.token,
        body: { content: 'ao vivo na voz' },
      });
      expect(sent.status).toBe(201);
      expect((await receivedMessage).message.channelId).toBe(voiceId);

      const receivedTyping = nextMessage(socket, 'typing');
      const typing = await client.call('POST', `/api/channels/${voiceId}/typing`, { token: owner.token });
      expect(typing.status).toBe(204);
      expect((await receivedTyping).channelId).toBe(voiceId);
    } finally {
      socket.close();
    }
  });

  test('two voice channels keep their own history', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, owner);
    const first = await helpers.createVoiceChannel(client, owner, guildId, 'lobby');
    const second = await helpers.createVoiceChannel(client, owner, guildId, 'sala-2');

    await client.call('POST', `/api/channels/${first}/messages`, { token: owner.token, body: { content: 'no lobby' } });
    await client.call('POST', `/api/channels/${second}/messages`, { token: owner.token, body: { content: 'na sala 2' } });

    const firstPage = await client.call('GET', `/api/channels/${first}/messages`, { token: owner.token });
    const secondPage = await client.call('GET', `/api/channels/${second}/messages`, { token: owner.token });

    expect(firstPage.body.messages.map((message: { content: string }) => message.content)).toEqual(['no lobby']);
    expect(secondPage.body.messages.map((message: { content: string }) => message.content)).toEqual(['na sala 2']);
  });
});
