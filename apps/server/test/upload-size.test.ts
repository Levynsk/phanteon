import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDataDir } from './helpers';

const dataDir = useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

const MAX_IMAGE = 8 * 1024 * 1024;

function pngOfSize(size: number): File {
  const bytes = new Uint8Array(size);
  // 1x1 PNG header so the image probe has something to read
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
  return new File([bytes], 'foto.png', { type: 'image/png' });
}

async function upload(token: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('upload size limit', () => {
  test('a body over the limit is refused with 413 and nothing is stored', async () => {
    const user = await client.register();
    await mkdir(join(dataDir, 'uploads'), { recursive: true });
    const before = (await readdir(join(dataDir, 'uploads'))).length;

    const res = await upload(user.token, pngOfSize(MAX_IMAGE + 1024));
    expect(res.status).toBe(413);

    const after = (await readdir(join(dataDir, 'uploads'))).length;
    expect(after).toBe(before);
  });

  test('a body under the limit is stored', async () => {
    const user = await client.register();
    const res = await upload(user.token, pngOfSize(1024));
    expect(res.status).toBe(201);
    expect(res.body.attachment.url).toContain('/files/');
  });
});
