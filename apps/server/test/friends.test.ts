import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

type User = Awaited<ReturnType<typeof client.register>>;

async function friends(token: string) {
  const res = await client.call('GET', '/api/friends', { token });
  return res.body.friends;
}

async function openDm(token: string, userId: string) {
  return client.call('POST', '/api/dms', { token, body: { userId } });
}

describe('friends and blocks', () => {
  test('request, accept and list with the right buckets', async () => {
    const a = await client.register();
    const b = await client.register();

    const request = await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    expect(request.status).toBe(201);
    expect(request.body.friends.outgoing.map((r: { user: { id: string } }) => r.user.id)).toEqual([b.user.id]);

    const incoming = await friends(b.token);
    expect(incoming.incoming).toHaveLength(1);
    expect(incoming.incoming[0].kind).toBe('incoming');

    const duplicate = await client.call('POST', `/api/friends/${a.user.id}`, { token: a.token });
    expect(duplicate.status).toBe(400);

    const accepted = await client.call('POST', `/api/friends/${a.user.id}/accept`, { token: b.token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.friends.friends).toHaveLength(1);
    expect(accepted.body.friends.incoming).toHaveLength(0);

    const aView = await friends(a.token);
    expect(aView.friends[0].kind).toBe('friend');
    expect(aView.outgoing).toHaveLength(0);

    const again = await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    expect(again.status).toBe(409);
  });

  test('declining and cancelling clear the request', async () => {
    const a = await client.register();
    const b = await client.register();
    const c = await client.register();

    await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    const declined = await client.call('DELETE', `/api/friends/${a.user.id}/request`, { token: b.token });
    expect(declined.status).toBe(200);
    expect(declined.body.friends.incoming).toHaveLength(0);

    await client.call('POST', `/api/friends/${c.user.id}`, { token: a.token });
    const cancelled = await client.call('DELETE', `/api/friends/${c.user.id}/request`, { token: a.token });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.friends.outgoing).toHaveLength(0);
  });

  test('crossed requests become a friendship', async () => {
    const a = await client.register();
    const b = await client.register();

    await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    const crossed = await client.call('POST', `/api/friends/${a.user.id}`, { token: b.token });
    expect(crossed.status).toBe(200);
    const list = await friends(b.token);
    expect(list.friends.map((r: { user: { id: string } }) => r.user.id)).toContain(a.user.id);
  });

  test('removing a friend works from both sides', async () => {
    const a = await client.register();
    const b = await client.register();
    await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    await client.call('POST', `/api/friends/${a.user.id}/accept`, { token: b.token });

    const removed = await client.call('DELETE', `/api/friends/${a.user.id}`, { token: b.token });
    expect(removed.status).toBe(200);
    expect(removed.body.friends.friends).toHaveLength(0);
    expect((await friends(a.token)).friends).toHaveLength(0);
  });

  test('blocking removes the friendship, stops DMs and rejects requests', async () => {
    const a = await client.register();
    const b = await client.register();
    await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    await client.call('POST', `/api/friends/${a.user.id}/accept`, { token: b.token });

    const dm = await openDm(a.token, b.user.id);
    expect(dm.status).toBe(201);
    const channelId = dm.body.dm.id as string;

    const blocked = await client.call('PUT', `/api/friends/${b.user.id}/block`, { token: a.token });
    expect(blocked.status).toBe(200);
    expect(blocked.body.friends.friends).toHaveLength(0);
    expect(blocked.body.friends.blocked.map((r: { user: { id: string } }) => r.user.id)).toEqual([b.user.id]);

    const bView = await friends(b.token);
    expect(bView.friends).toHaveLength(0);
    expect(bView.blocked).toHaveLength(0);

    const dmFromB = await openDm(b.token, a.user.id);
    expect(dmFromB.status).toBe(403);
    const dmFromA = await openDm(a.token, b.user.id);
    expect(dmFromA.status).toBe(403);

    const message = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: b.token,
      body: { content: 'oi?' },
    });
    expect(message.status).toBe(403);

    const request = await client.call('POST', `/api/friends/${a.user.id}`, { token: b.token });
    // the request is silently swallowed, the blocker sees nothing
    expect(request.status).toBe(200);
    expect((await friends(a.token)).incoming).toHaveLength(0);

    const quoted = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: a.token,
      body: { content: 'resposta', replyToId: 'whatever' },
    });
    expect(quoted.status).toBe(403);
  });

  test('reply quoting is refused inside a blocked DM', async () => {
    const a = await client.register();
    const b = await client.register();
    const dm = await openDm(a.token, b.user.id);
    const channelId = dm.body.dm.id as string;

    const first = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: b.token,
      body: { content: 'mensagem antiga' },
    });
    expect(first.status).toBe(201);

    await client.call('PUT', `/api/friends/${b.user.id}/block`, { token: a.token });

    const reply = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: a.token,
      body: { content: 'citando', replyToId: first.body.message.id },
    });
    expect(reply.status).toBe(403);
  });

  test('unblocking restores DMs and friendships can be re-made', async () => {
    const a = await client.register();
    const b = await client.register();
    await client.call('PUT', `/api/friends/${b.user.id}/block`, { token: a.token });

    const unblocked = await client.call('DELETE', `/api/friends/${b.user.id}/block`, { token: a.token });
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.friends.blocked).toHaveLength(0);

    const dm = await openDm(a.token, b.user.id);
    expect(dm.status).toBe(201);

    await client.call('POST', `/api/friends/${b.user.id}`, { token: a.token });
    await client.call('POST', `/api/friends/${a.user.id}/accept`, { token: b.token });
    expect((await friends(a.token)).friends).toHaveLength(1);
  });

  test('search finds users by @handle and by id', async () => {
    const me = await client.register();
    const target = await client.register();

    const byHandle = await client.call('GET', `/api/users?q=%40${target.user.username}`, { token: me.token });
    expect(byHandle.body.users[0].id).toBe(target.user.id);

    const byId = await client.call('GET', `/api/users?q=${target.user.id}`, { token: me.token });
    expect(byId.body.users[0].id).toBe(target.user.id);
  });
});
