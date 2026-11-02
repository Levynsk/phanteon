import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const helpers = await import('./helpers');
const { migrate } = await import('../src/db/migrate');
const { hub } = await import('../src/realtime/hub');
import type { SocketData } from '../src/realtime/hub';
const { resolveUserFromToken } = await import('../src/auth/middleware');
const { toPublicUser } = await import('../src/db/mappers');
const { AUTH_TIMEOUT_MS } = await import('../src/realtime/auth-timeout');

// mirrors the entrypoint's wiring: the socket authenticates by token, never by URL
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
      const url = new URL(request.url);
      if (url.pathname !== '/ws') return new Response('nope', { status: 404 });
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

afterAll(() => {
  server.stop(true);
});

const { createApp } = await import('../src/app');

const client = helpers.createClient(createApp());

function nextMessage(socket: WebSocket, filter: (event: { type: string }) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout esperando evento')), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data));
      if (!filter(parsed)) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      resolve(parsed);
    };
    socket.addEventListener('message', onMessage);
  });
}

function connect(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${server.port}/ws?token=nao-importa`);
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });
}

describe('websocket authenticates by first frame', () => {
  test('the URL token is ignored; the auth frame signs the socket in', async () => {
    const user = await client.register();
    const socket = await connect();
    try {
      const ready = nextMessage(socket, (event) => event.type === 'ready');
      socket.send(JSON.stringify({ type: 'auth', token: user.token }));
      const event = await ready;
      expect(event.userId).toBe(user.user.id);
    } finally {
      socket.close();
    }
  });

  test('events sent before authenticating are dropped', async () => {
    const socket = await connect();
    try {
      // a subscribe before `auth` must not open any room
      socket.send(JSON.stringify({ type: 'subscribe', channelIds: ['qualquer'] }));
      await Bun.sleep(150);
      const closed = await new Promise<boolean>((resolve) => {
        socket.addEventListener('close', () => resolve(true));
        setTimeout(() => resolve(false), 150);
      });
      expect(closed).toBe(false);
    } finally {
      socket.close();
    }
  });

  test('an invalid token closes the socket', async () => {
    const socket = await connect();
    const closed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)));
    socket.send(JSON.stringify({ type: 'auth', token: 'lixo' }));
    expect(await closed).toBe(4001);
  });
});
