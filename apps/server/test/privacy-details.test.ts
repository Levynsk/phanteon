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

describe('unfurl only fetches once the page is accepted', () => {
  test('a non-page reply is not remembered as a card', async () => {
    let answers = 0;
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        answers += 1;
        // first a plain-text reply with a domain-suggested card, then a real HTML title
        if (answers === 1) return new Response('texto', { headers: { 'content-type': 'text/plain' } });
        return new Response('<title>Titulo real</title>', { headers: { 'content-type': 'text/html' } });
      },
    });
    try {
      const user = await client.register();
      const url = encodeURIComponent(new URL('/pagina.html', server.url).toString());
      const res = await client.call('GET', `/api/unfurl?url=${url}`, { token: user.token });
      expect(res.status).toBe(400);
      expect(answers).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});

describe('DM opens cannot be used as a user directory', () => {
  test('random user ids, other people DMs and own channels do not answer', async () => {
    const me = await client.register();
    const other = await client.register();
    const third = await client.register();

    const random = await client.call('GET', `/api/dms/with/${crypto.randomUUID()}`, { token: me.token });
    expect(random.status).toBe(404);

    // a conversation between two other people is none of the viewer's business
    await client.call('POST', '/api/dms', { token: other.token, body: { userId: third.user.id } });
    const notMine = await client.call('GET', `/api/dms/with/${third.user.id}`, { token: me.token });
    expect(notMine.status).toBe(200);
    expect(notMine.body.channelId).toBeNull();

    const mine = await client.call('POST', '/api/dms', { token: me.token, body: { userId: third.user.id } });
    const own = await client.call('GET', `/api/dms/with/${third.user.id}`, { token: me.token });
    expect(own.body.channelId).toBe(mine.body.dm.id);
  });

  test('someone the viewer blocked has no conversation to look up', async () => {
    const me = await client.register();
    const target = await client.register();
    await client.call('POST', '/api/dms', { token: me.token, body: { userId: target.user.id } });
    await client.call('PUT', `/api/friends/${target.user.id}/block`, { token: me.token });
    const res = await client.call('GET', `/api/dms/with/${target.user.id}`, { token: me.token });
    // no conversation id is handed out while the block stands
    expect(res.status).toBe(200);
    expect(res.body.channelId).toBeNull();
    // and it comes back untouched once the block is lifted
    await client.call('DELETE', `/api/friends/${target.user.id}/block`, { token: me.token });
    const again = await client.call('GET', `/api/dms/with/${target.user.id}`, { token: me.token });
    expect(again.body.channelId).toBeString();
  });
});
