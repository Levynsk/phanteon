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

describe('session revocation', () => {
  test('logging out on every device invalidates old tokens', async () => {
    const user = await client.register();
    const other = await client.call('POST', '/api/auth/login', {
      body: { identifier: user.user.username, password: 'password123' },
    });
    expect(other.status).toBe(200);
    const second = other.body.token as string;

    const out = await client.call('POST', '/api/auth/logout', { token: user.token });
    expect(out.status).toBe(204);

    expect((await client.call('GET', '/api/auth/me', { token: user.token })).status).toBe(401);
    expect((await client.call('GET', '/api/auth/me', { token: second })).status).toBe(401);
  });

  test('logging out of other devices keeps this one signed in', async () => {
    const user = await client.register();
    const out = await client.call('POST', '/api/auth/logout?everywhere=false', { token: user.token });
    expect(out.status).toBe(200);
    expect((await client.call('GET', '/api/auth/me', { token: user.token })).status).toBe(401);
    expect((await client.call('GET', '/api/auth/me', { token: out.body.token })).status).toBe(200);
  });

  test('a password change needs the current password and signs other devices out', async () => {
    const user = await client.register();
    const wrong = await client.call('PATCH', '/api/auth/password', {
      token: user.token,
      body: { currentPassword: 'errada123', newPassword: 'novasenha123' },
    });
    // wrong password: 401, the same answer a login would give
    expect(wrong.status).toBe(401);

    const changed = await client.call('PATCH', '/api/auth/password', {
      token: user.token,
      body: { currentPassword: 'password123', newPassword: 'novasenha123' },
    });
    expect(changed.status).toBe(200);
    expect((await client.call('GET', '/api/auth/me', { token: user.token })).status).toBe(401);

    const relogin = await client.call('POST', '/api/auth/login', {
      body: { identifier: user.user.username, password: 'novasenha123' },
    });
    expect(relogin.status).toBe(200);
  });
});
