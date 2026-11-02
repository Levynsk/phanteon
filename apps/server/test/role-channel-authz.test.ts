import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { db, schema } = await import('../src/db/client');
const { hub } = await import('../src/realtime/hub');
const { Permission } = await import('@phanteon/shared');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

/** A connected socket stands in for the member's real client. */
function connect(userId: string, channelIds: string[]): { received: unknown[]; close: () => void } {
  const received: unknown[] = [];
  const sockets = (hub as unknown as { sockets: Map<string, Set<unknown>> }).sockets;
  const previous = sockets.get(userId);
  const stub = {
    data: { user: { id: userId, status: 'online' }, channelIds: new Set(channelIds) },
    subscribe() {},
    unsubscribe() {},
    send: (raw: string) => received.push(JSON.parse(raw)),
  };
  sockets.set(userId, new Set([stub]));
  (hub as unknown as { channelRooms: Map<string, Set<unknown>> }).channelRooms.set(channelIds[0]!, new Set([stub]));
  return {
    received,
    close: () => {
      if (previous) sockets.set(userId, previous);
      else sockets.delete(userId);
    },
  };
}

describe('a role that grants ManageRoles cannot take over a private channel', () => {
  test('no ManageRoles means visible channels cannot be changed', async () => {
    const owner = await client.register();
    const outsider = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'Segredo' } });
    const guildId = guild.body.guild.id as string;

    const roles = await client.call('GET', `/api/guilds/${guildId}/roles`, { token: owner.token });
    const everyone = roles.body.roles.find((role: { isEveryone?: boolean }) => role.isEveryone);

    // the outsider with ManageRoles but without any access to the guild may not edit its roles
    const res = await client.call('PATCH', `/api/guilds/${guildId}/roles/${everyone.id}`, {
      token: outsider.token,
      body: { allow: Permission.ViewChannel, deny: 0 },
    });
    expect([403, 404]).toContain(res.status);
  });

  test('a manager cannot hand out or edit a role that reaches a channel they do not see', async () => {
    const owner = await client.register();
    const manager = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, manager);
    const rest = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Resto', color: '#123456', permissions: 0 },
    });
    const managing = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Gerente', color: '#654321', permissions: Permission.ManageChannels | Permission.ManageRoles },
    });
    await client.call('PUT', `/api/guilds/${guildId}/member-roles/${manager.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [managing.body.role.id] },
    });

    // before it reaches the hidden channel the role is ordinary and editable
    const plain = await client.call('PATCH', `/api/guilds/${guildId}/roles/${rest.body.role.id}`, {
      token: manager.token,
      body: { color: '#abcdef' },
    });
    expect(plain.status).toBe(200);

    const hidden = await helpers.createVoiceChannel(client, owner, guildId, 'cofre');
    const closed = await client.call('PUT', `/api/channels/${hidden}/access`, {
      token: owner.token,
      body: { visibility: 'private', roleIds: [rest.body.role.id] },
    });
    expect(closed.status).toBe(200);

    // editing it, or handing it out, would move the manager past their own reach
    const edit = await client.call('PATCH', `/api/guilds/${guildId}/roles/${rest.body.role.id}`, {
      token: manager.token,
      body: { color: '#111111' },
    });
    expect(edit.status).toBe(403);

    const assign = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${manager.user.id}/roles`, {
      token: manager.token,
      body: { roleIds: [managing.body.role.id, rest.body.role.id] },
    });
    expect(assign.status).toBe(403);
  });

  test('ManageRoles does not reach channels the manager cannot see', async () => {
    const owner = await client.register();
    const manager = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, manager);
    const visible = (await helpers.guildChannels(client, owner.token, guildId)).find((c) => c.type === 'text')!;

    const role = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Gerente', color: '#123456', permissions: Permission.ManageChannels | Permission.ManageRoles },
    });
    const assign = await client.call('PUT', `/api/guilds/${guildId}/member-roles/${manager.user.id}/roles`, {
      token: owner.token,
      body: { roleIds: [role.body.role.id] },
    });
    expect(assign.status).toBe(200);

    // a channel they can see is theirs to manage
    const own = await client.call('PATCH', `/api/channels/${visible.id}`, {
      token: manager.token,
      body: { topic: 'ajustado pelo gerente' },
    });
    expect(own.status).toBe(200);

    // a private channel they cannot see is not
    const hidden = await helpers.createVoiceChannel(client, owner, guildId, 'cofre');
    await client.call('PUT', `/api/channels/${hidden}/access`, { token: owner.token, body: { visibility: 'private', roleIds: [] } });
    const reach = await client.call('PUT', `/api/channels/${hidden}/access`, {
      token: manager.token,
      body: { visibility: 'public' },
    });
    expect(reach.status).toBe(403);
  });
});
