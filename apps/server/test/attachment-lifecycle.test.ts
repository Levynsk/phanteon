import { beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { config } = await import('../src/config/env');
// the server module may have been loaded during the warm-up with another temp dir; follow its own
const dataDir = config.dataDir;
const { db, schema } = await import('../src/db/client');
const { eq } = await import('drizzle-orm');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

async function upload(token: string) {
  const form = new FormData();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
  form.append('file', new File([bytes], 'anexo.png', { type: 'image/png' }));
  const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const body = await res.json();
  return body.attachment as { id: string; url: string };
}

/**
 * `Bun.write` may keep bytes in the process until the next event-loop turn, so
 * neither the pending-handle size nor a native stat is reliable while other
 * files are in flight. A small reader waits for the flush; `deadline` bounds it.
 */
async function waitForSize(url: string, expected: number | 'missing'): Promise<number | null> {
  // attachment URLs are signed, so the name ends before the query string
  const path = join(dataDir, 'uploads', url.split('?')[0]!.split('/').pop()!);
  const deadline = Date.now() + 1000;
  for (;;) {
    const size = await readFile(path).then((buffer) => buffer.byteLength, () => null);
    if (expected === 'missing' ? size === null : size === expected) return size;
    if (Date.now() > deadline) return size;
    await Bun.sleep(10);
  }
}

describe('attachment lifecycle', () => {
  test('deleting a message removes its file from disk', async () => {
    const user = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: user.token, body: { name: 'g' } });
    const channel = (await helpers.guildChannels(client, user.token, guild.body.guild.id)).find((c) => c.type === 'text')!;
    const file = await upload(user.token);
    // the upload stream closes asynchronously; wait for the file to land
    expect(await waitForSize(file.url, 24)).toBe(24);

    const message = await client.call('POST', `/api/channels/${channel.id}/messages`, {
      token: user.token,
      body: { content: 'com anexo', attachmentIds: [file.id] },
    });
    expect(message.status).toBe(201);

    const deleted = await client.call('DELETE', `/api/channels/messages/${message.body.message.id}`, { token: user.token });
    expect(deleted.status).toBe(200);
    expect(db.select().from(schema.attachments).where(eq(schema.attachments.id, file.id)).get()).toBeUndefined();
    await Bun.sleep(50);
    expect(await waitForSize(file.url, 'missing')).toBeNull();
  });

  test('discarding one upload leaves the others intact', async () => {
    const user = await client.register();
    const kept = await upload(user.token);
    const gone = await upload(user.token);
    expect(await waitForSize(kept.url, 24)).toBe(24);
    const res = await client.call('DELETE', `/api/uploads/${gone.id}`, { token: user.token });
    expect(res.status).toBe(204);
    expect(await waitForSize(gone.url, 'missing')).toBeNull();
    expect(await waitForSize(kept.url, 24)).toBe(24);
  });
});
