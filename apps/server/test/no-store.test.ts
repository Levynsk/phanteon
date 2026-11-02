import { describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');

const app = createApp();

describe('API responses are not cacheable', () => {
  test('authenticated JSON answers carry no-store', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'x', password: 'y' }),
    });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('pragma')).toBe('no-cache');
  });

  test('error answers too', async () => {
    const res = await app.request('/api/users', { method: 'GET' });
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  test('files are not public: without a session they are refused, never cached', async () => {
    const res = await app.request('/files/naoexiste.png');
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });
});
