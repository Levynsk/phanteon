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

describe('private channel history', () => {
  test('a member who loses ViewChannel (private category) cannot read the history', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const channels = await helpers.guildChannels(client, owner.token, guildId);
    const text = channels.find((channel) => channel.type === 'text')!;

    const posted = await client.call('POST', `/api/channels/${text.id}/messages`, {
      token: owner.token,
      body: { content: 'segredo do canal privado' },
    });
    expect(posted.status).toBeLessThan(300);
    const before = await client.call('GET', `/api/channels/${text.id}/messages`, { token: member.token });
    expect(before.status).toBe(200);

    // a category that only a role the member lacks may see
    const secret = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'vip', permissions: 0 },
    });
    const category = await client.call('POST', `/api/guilds/${guildId}/categories`, {
      token: owner.token,
      body: { name: 'privado', visibility: 'private', roleIds: [secret.body.role.id] },
    });
    expect(category.status).toBeLessThan(300);
    // the endpoint replaces the whole ordering, so send every channel with the text one re-parented
    const categoryId = category.body.channel?.id ?? category.body.id;
    const current = await helpers.guildChannels(client, owner.token, guildId);
    const moved = await client.call('PUT', `/api/guilds/${guildId}/channels/order`, {
      token: owner.token,
      body: { items: current.map((channel) => ({ id: channel.id, categoryId: channel.id === text.id ? categoryId : null })) },
    });
    expect(moved.status).toBeLessThan(300);

    const after = await client.call('GET', `/api/channels/${text.id}/messages`, { token: member.token });
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.body)).not.toContain('segredo');

    // the role holder still reads it
    const viewer = await client.register();
    const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
    await client.call('POST', '/api/guilds/join', { token: viewer.token, body: { code: invite.body.invite.code } });
    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${viewer.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [secret.body.role.id] },
    });
    const allowed = await client.call('GET', `/api/channels/${text.id}/messages`, { token: viewer.token });
    expect(allowed.status).toBe(200);
  });
});
