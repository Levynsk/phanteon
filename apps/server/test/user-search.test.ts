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

describe('user search cannot enumerate accounts', () => {
  test('an empty or single-character query returns nothing', async () => {
    const owner = await client.register();
    const other = await client.register();
    for (const query of ['', ' ', other.user.username.slice(0, 1)]) {
      const res = await client.call('GET', `/api/users?q=${encodeURIComponent(query)}`, { token: owner.token });
      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(0);
    }
  });

  test('a real term still finds people', async () => {
    const owner = await client.register();
    const other = await client.register('buscavel' + Math.floor(Math.random() * 100000));
    const res = await client.call('GET', `/api/users?q=${other.user.username}`, { token: owner.token });
    expect(res.body.users.map((user: { id: string }) => user.id)).toContain(other.user.id);
  });
});
