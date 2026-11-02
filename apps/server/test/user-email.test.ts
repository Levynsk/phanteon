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

describe('account e-mail visibility', () => {
  test('only the owner receives their own e-mail', async () => {
    const me = await client.register();
    const email = `${me.user.username}@test.local`;
    // register and /me both carry the address, so the owner always has it
    const current = await client.call('GET', '/api/auth/me', { token: me.token });
    expect(current.body.user.email).toBe(email);
  });

  test('profile bio is public, trimmed and limited to 190 characters', async () => {
    const me = await client.register();
    const saved = await client.call('PATCH', '/api/users/@me', {
      token: me.token,
      body: { bio: '  Olá, comunidade!  ' },
    });
    expect(saved.body.user.bio).toBe('Olá, comunidade!');

    const profile = await client.call('GET', `/api/users/${me.user.id}`, { token: me.token });
    expect(profile.body.user.bio).toBe('Olá, comunidade!');

    const cleared = await client.call('PATCH', '/api/users/@me', { token: me.token, body: { bio: '   ' } });
    expect(cleared.body.user.bio).toBeNull();

    const tooLong = await client.call('PATCH', '/api/users/@me', { token: me.token, body: { bio: 'a'.repeat(191) } });
    expect(tooLong.status).toBe(400);
  });

  test('a stranger cannot harvest an e-mail through a friend request or a guild', async () => {
    const victim = await client.register();
    const attacker = await client.register();

    // the audit case: POST a friend request, then read the pushed/pending entry
    const request = await client.call('POST', `/api/friends/${victim.user.id}`, { token: attacker.token });
    expect(request.status).toBeLessThan(300);

    const overview = await client.call('GET', '/api/friends', { token: attacker.token });
    const pending = JSON.stringify(overview.body);
    expect(pending).not.toContain(`${victim.user.username}@test.local`);
    expect(pending).not.toContain('@test.local');

    // profile lookup and guild memberships are just as public
    const profile = await client.call('GET', `/api/users/${victim.user.id}`, { token: attacker.token });
    expect(profile.body.user.email).toBeUndefined();

    const guildId = await helpers.sharedGuild(client, victim, attacker);
    const details = await client.call('GET', `/api/guilds/${guildId}`, { token: attacker.token });
    expect(JSON.stringify(details.body.guild.members)).not.toContain('@test.local');

    // the member card endpoint used by the client
    const member = await client.call('GET', `/api/members/${victim.user.id}`, {
      token: attacker.token,
    });
    expect(JSON.stringify(member.body)).not.toContain('@test.local');

    // search results too
    const search = await client.call('GET', `/api/users?q=${victim.user.username}`, { token: attacker.token });
    expect(JSON.stringify(search.body)).not.toContain('@test.local');
  });
});
