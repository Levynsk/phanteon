import { beforeAll, describe, expect, test } from 'bun:test';
import {
  MAX_ARCHIVE_UPLOAD_BYTES,
  MAX_FILE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from '@phanteon/shared';
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

function form(file: File) {
  const data = new FormData();
  data.append('file', file);
  return data;
}

async function upload(token: string, file: File) {
  const response = await app.request('/api/uploads', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form(file),
  });
  return { status: response.status, body: (await response.json()) as any };
}

/** Smallest valid PNG (1x1) so the dimension reader has something real to parse. */
const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

function bytesOf(size: number, head: number[] = []): Uint8Array {
  const out = new Uint8Array(size);
  out.set(head.slice(0, size));
  return out;
}

describe('message uploads', () => {
  test('accepts images, video, zip and generic files with the right metadata', async () => {
    const user = await client.register();

    const image = await upload(user.token, new File([PNG_BYTES], 'pixel.png', { type: 'image/png' }));
    expect(image.status).toBe(201);
    expect(image.body.attachment.width).toBe(1);
    expect(image.body.attachment.mimeType).toBe('image/png');

    const video = await upload(user.token, new File([bytesOf(2048, [0, 0, 0, 24])], 'clipe.mp4', { type: 'video/mp4' }));
    expect(video.status).toBe(201);
    expect(video.body.attachment.url).toMatch(/\.mp4(\?|$)/);

    // browsers often send an empty type for archives: the extension decides
    const archive = await upload(user.token, new File([bytesOf(4096, [0x50, 0x4b, 0x03, 0x04])], 'pacote.zip', { type: '' }));
    expect(archive.status).toBe(201);
    expect(archive.body.attachment.url).toMatch(/\.zip(\?|$)/);

    const document = await upload(user.token, new File(['ola'], 'notas.txt', { type: '' }));
    expect(document.status).toBe(201);
    expect(document.body.attachment.url).toMatch(/\.txt(\?|$)/);
  });

  test('rejects executables and unknown types', async () => {
    const user = await client.register();
    const exe = await upload(user.token, new File([bytesOf(64)], 'virus.exe', { type: 'application/x-msdownload' }));
    expect(exe.status).toBe(400);

    const script = await upload(user.token, new File(['<script>'], 'page.html', { type: 'text/html' }));
    expect(script.status).toBe(400);

    const empty = await upload(user.token, new File([], 'vazio.png', { type: 'image/png' }));
    expect(empty.status).toBe(400);
  });

  test('enforces a size ceiling per kind', async () => {
    const user = await client.register();

    const bigImage = await upload(user.token, new File([bytesOf(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' }));
    expect(bigImage.status).toBe(413);

    const bigVideo = await upload(user.token, new File([bytesOf(MAX_VIDEO_UPLOAD_BYTES + 1)], 'big.mp4', { type: 'video/mp4' }));
    expect(bigVideo.status).toBe(413);

    const bigZip = await upload(user.token, new File([bytesOf(MAX_ARCHIVE_UPLOAD_BYTES + 1)], 'big.zip', { type: 'application/zip' }));
    expect(bigZip.status).toBe(413);

    const bigDoc = await upload(user.token, new File([bytesOf(MAX_FILE_UPLOAD_BYTES + 1)], 'big.pdf', { type: 'application/pdf' }));
    expect(bigDoc.status).toBe(413);
  });

  test('serves files with the stored type and marks non-media as attachments', async () => {
    const user = await client.register();
    const archive = await upload(user.token, new File([bytesOf(128)], 'dados.zip', { type: 'application/zip' }));
    const name = (archive.body.attachment.url as string).split('/').pop() as string;

    const media = await app.request(`/files/${name}`, { headers: { authorization: `Bearer ${user.token}` } });
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('application/zip');
    expect(media.headers.get('content-disposition')).toContain('attachment');
    expect(media.headers.get('x-content-type-options')).toBe('nosniff');

    const missing = await app.request('/files/nao-existe.zip', { headers: { authorization: `Bearer ${user.token}` } });
    expect(missing.status).toBe(404);
  });

  test('an attachment can be discarded by its owner only', async () => {
    const owner = await client.register();
    const other = await client.register();
    const uploaded = await upload(owner.token, new File([PNG_BYTES], 'a.png', { type: 'image/png' }));
    const id = uploaded.body.attachment.id as string;

    const denied = await client.call('DELETE', `/api/uploads/${id}`, { token: other.token });
    expect(denied.status).toBe(404);

    const removed = await client.call('DELETE', `/api/uploads/${id}`, { token: owner.token });
    expect(removed.status).toBe(204);
  });
});

describe('link unfurl', () => {
  test('refuses loopback and invalid links', async () => {
    const user = await client.register();

    const localhost = await client.call('GET', '/api/unfurl?url=http%3A%2F%2Flocalhost%3A3010%2Fapi', { token: user.token });
    expect(localhost.status).toBe(400);

    const priv = await client.call('GET', '/api/unfurl?url=http%3A%2F%2F192.168.0.10%2F', { token: user.token });
    expect(priv.status).toBe(400);

    const invalid = await client.call('GET', '/api/unfurl?url=nope', { token: user.token });
    expect(invalid.status).toBe(400);
  });
});
