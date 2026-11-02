import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { isChannelVisibleTo } = await import('../src/realtime/audience');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

describe('channel audiences follow permissions', () => {
  test('a channel turned private hides it from members without access', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const text = (await helpers.guildChannels(client, owner.token, guildId)).find((channel) => channel.type === 'text')!;
    expect(isChannelVisibleTo(text.id, member.user.id)).toBe(true);

    const closed = await client.call('PUT', `/api/channels/${text.id}/access`, {
      token: owner.token,
      body: { visibility: 'private', roleIds: [] },
    });
    expect(closed.status).toBe(200);
    expect(isChannelVisibleTo(text.id, member.user.id)).toBe(false);

    // and the member cannot read or write it any more
    const history = await client.call('GET', `/api/channels/${text.id}/messages`, { token: member.token });
    expect(history.status).toBe(403);

    const reopened = await client.call('PUT', `/api/channels/${text.id}/access`, {
      token: owner.token,
      body: { visibility: 'public' },
    });
    expect(reopened.status).toBe(200);
    expect(isChannelVisibleTo(text.id, member.user.id)).toBe(true);
  });
});
