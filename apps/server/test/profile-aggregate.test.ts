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

describe('aggregate user profile endpoint', () => {
  test('returns a public user without member details for unrelated users', async () => {
    const viewer = await client.register();
    const target = await client.register();
    const res = await client.call('GET', `/api/members/${target.user.id}`, { token: viewer.token });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(target.user.id);
    expect(res.body.member).toBeNull();
    expect(res.body.user).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('@test.local');
  });

  test('returns public user and shared guild member in one response', async () => {
    const owner = await client.register();
    const member = await client.register();
    await helpers.sharedGuild(client, owner, member);
    const res = await client.call('GET', `/api/members/${member.user.id}`, { token: owner.token });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(member.user.id);
    expect(res.body.member.user.id).toBe(member.user.id);
    expect(res.body.member.guildId).toBeTruthy();
    expect(res.body.user).not.toHaveProperty('email');
    expect(res.body.member.user).not.toHaveProperty('email');
  });
});
