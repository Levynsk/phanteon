import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { db, schema } = await import('../src/db/client');
const { blockUser } = await import('../src/services/relationships');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

async function conversations(token: string): Promise<{ id: string; recipients: { id: string }[]; blocked: boolean }[]> {
  const res = await client.call('GET', '/api/dms', { token });
  expect(res.status).toBe(200);
  return res.body.dms;
}

describe('blocking takes the conversation off the list', () => {
  test('the blocked person disappears from the blocker DM list and comes back on unblock', async () => {
    const blocker = await client.register();
    const target = await client.register();
    const dm = await client.call('POST', '/api/dms', { token: blocker.token, body: { userId: target.user.id } });
    const channelId = dm.body.dm.id as string;
    expect((await conversations(blocker.token)).map((entry) => entry.id)).toContain(channelId);

    blockUser(blocker.user.id, target.user.id);
    const afterBlock = await conversations(blocker.token);
    expect(afterBlock.map((entry) => entry.id)).not.toContain(channelId);

    // the list is unchanged in storage: killing the channel would let the blocker
    // re-open it and start a clean memory, which is exactly what a block forbids
    const untouched = db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
    expect(untouched).toBeDefined();
    const block = await client.call('GET', '/api/dms', { token: blocker.token });
    expect(block.status).toBe(200);

    // the blocked side still has the history, but cannot write into it
    expect((await conversations(target.token)).map((entry) => entry.id)).toContain(channelId);
    const write = await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: target.token,
      body: { content: 'oi?' },
    });
    expect(write.status).toBe(403);

    await client.call('DELETE', `/api/friends/${target.user.id}/block`, { token: blocker.token });
    expect((await conversations(blocker.token)).map((entry) => entry.id)).toContain(channelId);
  });
});
