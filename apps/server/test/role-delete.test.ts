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

describe('role deletion', () => {
  test('a deleted role reports success, and deleting it twice is not an error', async () => {
    const owner = await client.register();
    const guildId = (await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'Roles' } })).body.guild.id;

    const role = await client.call('POST', `/api/guilds/${guildId}/roles`, {
      token: owner.token,
      body: { name: 'Descartável' },
    });
    expect(role.status).toBe(201);
    const roleId = role.body.role.id as string;

    const first = await client.call('DELETE', `/api/guilds/${guildId}/roles/${roleId}`, { token: owner.token });
    expect(first.status).toBe(204);

    // a double click or a retried request lands here: the role is already gone
    const second = await client.call('DELETE', `/api/guilds/${guildId}/roles/${roleId}`, { token: owner.token });
    expect(second.status).toBe(204);

    const roles = await client.call('GET', `/api/guilds/${guildId}/roles`, { token: owner.token });
    expect(roles.body.roles.some((entry: { id: string }) => entry.id === roleId)).toBe(false);
  });

  test('system roles still cannot be deleted', async () => {
    const owner = await client.register();
    const guildId = (await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'Roles 2' } })).body.guild.id;

    const roles = await client.call('GET', `/api/guilds/${guildId}/roles`, { token: owner.token });
    const admin = roles.body.roles.find((entry: { name: string }) => entry.name === 'Administrador');
    const res = await client.call('DELETE', `/api/guilds/${guildId}/roles/${admin.id}`, { token: owner.token });
    expect(res.status).toBe(403);
  });
});
