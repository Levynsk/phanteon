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

const emailOf = (username: string) => `${username}@test.local`;

describe('blocks and personal data', () => {
  test('a blocked user cannot read the blocker profile (no e-mail), the blocker can', async () => {
    const blocker = await client.register();
    const target = await client.register();
    await client.call('PUT', `/api/friends/${target.user.id}/block`, { token: blocker.token });

    const seenByTarget = await client.call('GET', `/api/users/${blocker.user.id}`, { token: target.token });
    expect(seenByTarget.status).toBe(200);
    expect(seenByTarget.body.user.email).toBeUndefined();
    // the block replaces any prior relationship; the target must not be listed as a friend
    const targetView = await client.call('GET', '/api/friends', { token: target.token });
    expect(targetView.body.friends.friends).toHaveLength(0);

    const seenByBlocker = await client.call('GET', `/api/users/${target.user.id}`, { token: blocker.token });
    expect(seenByBlocker.body.user.email).toBeUndefined();
  });

  test('only the account owner ever sees their e-mail', async () => {
    const me = await client.register();
    const other = await client.register();

    const own = await client.call('GET', '/api/auth/me', { token: me.token });
    expect(own.body.user.email).toBe(emailOf(me.user.username));

    const theirs = await client.call('GET', `/api/users/${me.user.id}`, { token: other.token });
    expect(theirs.body.user.email).toBeUndefined();

    const search = await client.call('GET', `/api/users?q=${me.user.username}`, { token: other.token });
    for (const user of search.body.users) expect(user.email).toBeUndefined();

    const friends = await client.call('GET', '/api/friends', { token: other.token });
    expect(JSON.stringify(friends.body)).not.toContain('@test.local');
  });

  test('an existing DM with a blocked user is closed to both sides', async () => {
    const a = await client.register();
    const b = await client.register();
    const dm = await client.call('POST', '/api/dms', { token: a.token, body: { userId: b.user.id } });
    const channelId = dm.body.dm.id as string;
    const sent = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: b.token,
      body: { content: 'antes do bloqueio' },
    });
    expect(sent.status).toBe(201);

    await client.call('PUT', `/api/friends/${b.user.id}/block`, { token: a.token });

    const fromBlocked = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: b.token,
      body: { content: 'depois do bloqueio' },
    });
    expect(fromBlocked.status).toBe(403);

    const fromBlocker = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: a.token,
      body: { content: 'depois do bloqueio' },
    });
    expect(fromBlocker.status).toBe(403);

    // history stays readable for the blocker, but the blocked side can still open it
    const history = await client.call('GET', `/api/channels/${channelId}/messages`, { token: a.token });
    expect(history.status).toBe(200);
  });
});
