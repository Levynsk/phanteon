import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { publicOrigin } = await import('../src/http/origin');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

describe('the public origin cannot be forged by a header', () => {
  test('a forwarded host that is not an allowed host is ignored', () => {
    const headers = (name: string) =>
      ({ 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', host: 'localhost:3010' })[name] as string | undefined;
    const origin = publicOrigin(headers, ['localhost:3010']);
    // the forwarded host is dropped; the host and proto headers themselves stay untrusted
    expect(origin.startsWith('https://localhost:3010')).toBe(true);
  });

  test('a forwarded host on the allowlist is used', () => {
    const headers = (name: string) =>
      ({ 'x-forwarded-host': 'app.example', 'x-forwarded-proto': 'https' })[name] as string | undefined;
    expect(publicOrigin(headers, ['app.example'])).toBe('https://app.example');
  });

  test('a forged forwarded host never lands in an upload URL', async () => {
    useTempDataDir();
    const user = await client.register();
    const form = new FormData();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
    form.append('file', new File([bytes], 'foto.png', { type: 'image/png' }));
    // a fresh app reads the origin middleware with the temp data dir in place
    const { createApp } = await import('../src/app');
    const { migrate } = await import('../src/db/migrate');
    migrate();
    const res = await createApp().request('/api/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${user.token}`, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
      body: form,
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.attachment.url).not.toContain('evil.example');
  });
});
