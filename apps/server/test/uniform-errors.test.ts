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

describe('uniform errors', () => {
  test('an unknown invite code and someone else’s invite answer identically', async () => {
    const owner = await client.register();
    const stranger = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, stranger);
    const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });

    const unknown = await client.call('DELETE', '/api/invites/naoexiste', { token: stranger.token });
    const foreign = await client.call('DELETE', `/api/invites/${invite.body.invite.code}`, { token: stranger.token });
    expect(foreign.status).toBe(unknown.status);
    expect(foreign.body).toEqual(unknown.body);
  });
});
