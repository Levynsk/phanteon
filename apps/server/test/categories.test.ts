import { beforeAll, describe, expect, test } from 'bun:test';
import { Permission } from '@phanteon/shared';
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

async function setup() {
  const owner = await client.register();
  const member = await client.register();
  const guildId = await helpers.sharedGuild(client, owner, member);
  return { owner, member, guildId };
}

async function roles(token: string, guildId: string) {
  const res = await client.call('GET', `/api/guilds/${guildId}/roles`, { token });
  return res.body.roles as { id: string; name: string }[];
}

async function channels(token: string, guildId: string) {
  const res = await client.call('GET', `/api/guilds/${guildId}`, { token });
  return res.body.guild.channels as { id: string; name: string; type: string; categoryId: string | null; private: boolean; position: number }[];
}

describe('channel categories', () => {
  test('creates a public category and nests a channel inside it', async () => {
    const { owner, guildId } = await setup();

    const created = await client.call('POST', `/api/guilds/${guildId}/categories`, {
      token: owner.token,
      body: { name: 'Projetos' },
    });
    expect(created.status).toBe(201);
    expect(created.body.channel.type).toBe('category');
    expect(created.body.channel.private).toBe(false);

    const child = await client.call('POST', `/api/guilds/${guildId}/channels`, {
      token: owner.token,
      body: { name: 'ideias', categoryId: created.body.channel.id },
    });
    expect(child.status).toBe(201);
    expect(child.body.channel.categoryId).toBe(created.body.channel.id);

    // the same name is allowed in another category, like Discord
    const other = await client.call('POST', `/api/guilds/${guildId}/categories`, { token: owner.token, body: { name: 'Arquivo' } });
    const nested = await client.call('POST', `/api/guilds/${guildId}/channels`, {
      token: owner.token,
      body: { name: 'ideias', categoryId: other.body.channel.id },
    });
    expect(nested.status).toBe(201);

    const list = await channels(owner.token, guildId);
    expect(list.filter((channel) => channel.categoryId === created.body.channel.id)).toHaveLength(1);
  });

  test('a private category hides its channels from @everyone but not from the listed role', async () => {
    const { owner, member, guildId } = await setup();
    // the member starts on the default role; the private category lists a second one
    const granted = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Bastidores', permissions: 0 },
    });
    expect(granted.status).toBe(201);
    const memberRole = granted.body.role as { id: string };

    const category = await client.call('POST', `/api/guilds/${guildId}/categories`, {
      token: owner.token,
      body: { name: 'Staff', visibility: 'private', roleIds: [memberRole.id] },
    });
    expect(category.status).toBe(201);
    expect(category.body.channel.private).toBe(true);

    const channel = await client.call('POST', `/api/guilds/${guildId}/channels`, {
      token: owner.token,
      body: { name: 'bastidores', categoryId: category.body.channel.id },
    });
    const channelId = channel.body.channel.id as string;

    // before the role is granted, the member cannot read it
    const denied = await client.call('GET', `/api/channels/${channelId}/messages`, { token: member.token });
    expect(denied.status).toBe(403);

    const assigned = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${member.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [memberRole.id] },
    });
    expect(assigned.status).toBe(200);

    const allowed = await client.call('GET', `/api/channels/${channelId}/messages`, { token: member.token });
    expect(allowed.status).toBe(200);

    // the owner always has access
    const ownerView = await client.call('GET', `/api/channels/${channelId}/messages`, { token: owner.token });
    expect(ownerView.status).toBe(200);
  });

  test('switching a channel to private and back rewrites the @everyone override', async () => {
    const { owner, member, guildId } = await setup();
    const [memberRole] = (await roles(owner.token, guildId)).filter((role) => role.name === 'Membro');
    const created = await client.call('POST', `/api/guilds/${guildId}/channels`, { token: owner.token, body: { name: 'sigilo' } });
    const channelId = created.body.channel.id as string;

    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${member.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [memberRole!.id] },
    });

    const priv = await client.call('PUT', `/api/channels/${channelId}/access`, {
      token: owner.token,
      body: { visibility: 'private', roleIds: [memberRole!.id] },
    });
    expect(priv.status).toBe(200);
    expect(priv.body.channel.private).toBe(true);

    const detail = await client.call('GET', `/api/channels/${channelId}`, { token: owner.token });
    const everyone = detail.body.overrides.find((override: { roleId: string }) => override.roleId === '@everyone');
    expect((everyone.deny & Permission.ViewChannel) === Permission.ViewChannel).toBe(true);

    const pub = await client.call('PUT', `/api/channels/${channelId}/access`, {
      token: owner.token,
      body: { visibility: 'public' },
    });
    expect(pub.body.channel.private).toBe(false);
    const after = await client.call('GET', `/api/channels/${channelId}`, { token: owner.token });
    const everyoneAfter = after.body.overrides.find((override: { roleId: string }) => override.roleId === '@everyone');
    expect(everyoneAfter ? (everyoneAfter.deny & Permission.ViewChannel) === Permission.ViewChannel : false).toBe(false);
  });

  test('a private channel maps the @everyone deny onto the guild everyone role', async () => {
    const { owner, member, guildId } = await setup();
    const everyonesRole = (await roles(owner.token, guildId)).find((role) => role.isEveryone)!;
    const created = await client.call('POST', `/api/guilds/${guildId}/channels`, { token: owner.token, body: { name: 'segredo' } });
    const channelId = created.body.channel.id as string;

    const before = await client.call('GET', `/api/channels/${channelId}/messages`, { token: member.token });
    expect(before.status).toBe(200);

    await client.call('PUT', `/api/channels/${channelId}/access`, { token: owner.token, body: { visibility: 'private', roleIds: [] } });
    const hidden = await client.call('GET', `/api/channels/${channelId}/messages`, { token: member.token });
    expect(hidden.status).toBe(403);

    // granting the guild's @everyone role maps onto the same deny
    await client.call('PUT', `/api/channels/${channelId}/access`, {
      token: owner.token,
      body: { visibility: 'private', roleIds: [everyonesRole.id] },
    });
    const shown = await client.call('GET', `/api/channels/${channelId}/messages`, { token: member.token });
    expect(shown.status).toBe(200);
  });

  test('the guild view hides private channels the member cannot see', async () => {
    const { owner, member, guildId } = await setup();
    const created = await client.call('POST', `/api/guilds/${guildId}/channels`, { token: owner.token, body: { name: 'oculto' } });
    const channelId = created.body.channel.id as string;
    await client.call('PUT', `/api/channels/${channelId}/access`, { token: owner.token, body: { visibility: 'private', roleIds: [] } });

    const memberView = await client.call('GET', `/api/guilds/${guildId}`, { token: member.token });
    expect(memberView.body.guild.channels.some((channel: { id: string }) => channel.id === channelId)).toBe(false);

    const ownerView = await client.call('GET', `/api/guilds/${guildId}`, { token: owner.token });
    expect(ownerView.body.guild.channels.some((channel: { id: string }) => channel.id === channelId)).toBe(true);
  });

  test('reorders channels and moves them between categories', async () => {
    const { owner, guildId } = await setup();
    const category = await client.call('POST', `/api/guilds/${guildId}/categories`, { token: owner.token, body: { name: 'Mover' } });
    const list = await channels(owner.token, guildId);
    const general = list.find((channel) => channel.name === 'geral')!;

    const ordered = [
      { id: category.body.channel.id, categoryId: null },
      { id: general.id, categoryId: category.body.channel.id },
    ];
    const res = await client.call('PUT', `/api/guilds/${guildId}/channels/order`, { token: owner.token, body: { items: ordered } });
    expect(res.status).toBe(200);

    const after = await channels(owner.token, guildId);
    expect(after.find((channel) => channel.id === general.id)!.categoryId).toBe(category.body.channel.id);
    expect(after.find((channel) => channel.id === category.body.channel.id)!.position).toBe(0);

    const incomplete = await client.call('PUT', `/api/guilds/${guildId}/channels/order`, {
      token: owner.token,
      body: { items: [ordered[0]!] },
    });
    expect(incomplete.status).toBe(400);
  });

  test('deleting a category keeps its channels at the top level', async () => {
    const { owner, guildId } = await setup();
    const category = await client.call('POST', `/api/guilds/${guildId}/categories`, { token: owner.token, body: { name: 'Temporária' } });
    const child = await client.call('POST', `/api/guilds/${guildId}/channels`, {
      token: owner.token,
      body: { name: 'filho', categoryId: category.body.channel.id },
    });

    const removed = await client.call('DELETE', `/api/guilds/${guildId}/categories/${category.body.channel.id}`, {
      token: owner.token,
    });
    expect(removed.status).toBe(204);

    const after = await channels(owner.token, guildId);
    expect(after.some((channel) => channel.id === category.body.channel.id)).toBe(false);
    expect(after.find((channel) => channel.id === child.body.channel.id)!.categoryId).toBeNull();
  });

  test('syncing a category pushes its overrides to child channels', async () => {
    const { owner, guildId } = await setup();
    const category = await client.call('POST', `/api/guilds/${guildId}/categories`, {
      token: owner.token,
      body: { name: 'Sincronizada', visibility: 'private', roleIds: [] },
    });
    const child = await client.call('POST', `/api/guilds/${guildId}/channels`, {
      token: owner.token,
      body: { name: 'copia', categoryId: category.body.channel.id },
    });

    const synced = await client.call('POST', `/api/guilds/${guildId}/categories/${category.body.channel.id}/sync-permissions`, {
      token: owner.token,
    });
    expect(synced.status).toBe(200);
    expect(synced.body.channels[0].private).toBe(true);

    const detail = await client.call('GET', `/api/channels/${child.body.channel.id}`, { token: owner.token });
    const everyone = detail.body.overrides.find((override: { roleId: string }) => override.roleId === '@everyone');
    expect((everyone.deny & Permission.ViewChannel) === Permission.ViewChannel).toBe(true);
  });

  test('only channel managers can create categories', async () => {
    const { member, guildId } = await setup();
    const denied = await client.call('POST', `/api/guilds/${guildId}/categories`, {
      token: member.token,
      body: { name: 'Nova' },
    });
    expect(denied.status).toBe(403);
  });
});
