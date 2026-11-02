import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { hub } = await import('../src/realtime/hub');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

/** Registers a connected socket for `userId` without opening a real one. */
function markOnline(userId: string): () => void {
  const sockets = (hub as unknown as { sockets: Map<string, Set<unknown>> }).sockets;
  const stub = { data: { user: { id: userId, status: 'online' } }, subscribe() {}, unsubscribe() {}, send() {} };
  const previous = sockets.get(userId);
  sockets.set(userId, new Set([stub]));
  return () => {
    if (previous) sockets.set(userId, previous);
    else sockets.delete(userId);
  };
}

async function onlineFrom(token: string): Promise<string[]> {
  const res = await client.call('GET', '/api/presence/online', { token });
  expect(res.status).toBe(200);
  return res.body.userIds as string[];
}

describe('online presence is scoped to people you share something with', () => {
  test('a stranger is not listed', async () => {
    const me = await client.register();
    const stranger = await client.register();
    const restore = markOnline(stranger.user.id);
    try {
      expect(await onlineFrom(me.token)).not.toContain(stranger.user.id);
    } finally {
      restore();
    }
  });

  test('someone from the same server is listed', async () => {
    const owner = await client.register();
    const member = await client.register();
    await helpers.sharedGuild(client, owner, member);
    const restore = markOnline(member.user.id);
    try {
      expect(await onlineFrom(owner.token)).toContain(member.user.id);
    } finally {
      restore();
    }
  });

  test('a direct-message partner is listed', async () => {
    const a = await client.register();
    const b = await client.register();
    await client.call('POST', '/api/dms', { token: a.token, body: { userId: b.user.id } });
    const restore = markOnline(b.user.id);
    try {
      expect(await onlineFrom(a.token)).toContain(b.user.id);
    } finally {
      restore();
    }
  });
});
