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

describe('guild internals stay inside the guild', () => {
  test('an outsider cannot list the categories and roles of a server', async () => {
    const owner = await client.register();
    const outsider = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'Privado' } });
    const guildId = guild.body.guild.id as string;

    const categories = await client.call('GET', `/api/guilds/${guildId}/categories`, { token: outsider.token });
    expect(categories.status).toBe(403);

  });

  test('a member still can', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const allowed = await client.call('GET', `/api/guilds/${guildId}/categories`, { token: member.token });
    expect(allowed.status).toBe(200);
  });
});
