import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { AppVariables } from '../src/http/context';

/** Points the server at a throwaway database + uploads folder. Call before importing src. */
export function useTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phanteon-test-'));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_PATH = join(dir, 'test.db');
  return dir;
}

export interface TestClient {
  token: string;
  user: { id: string; username: string };
}

export function createClient(app: Hono<{ Variables: AppVariables }>) {
  const call = async (method: string, path: string, input?: { body?: unknown; token?: string }) => {
    const headers: Record<string, string> = {};
    if (input?.body !== undefined) headers['content-type'] = 'application/json';
    if (input?.token) headers.authorization = `Bearer ${input.token}`;
    const res = await app.request(path, {
      method,
      headers,
      body: input?.body !== undefined ? JSON.stringify(input.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  };

  let counter = 0;
  const register = async (username?: string) => {
    counter += 1;
    const name = username ?? `user${counter}${Date.now() % 100000}`;
    const res = await call('POST', '/api/auth/register', {
      body: { username: name, displayName: name, email: `${name}@test.local`, password: 'password123' },
    });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    const token = res.body.token as string;
    const user = res.body.user as { id: string; username: string };
    return { token, user };
  };

  return { call, register };
}


/** Creates a guild owned by `owner` and moves `member` in through an invite. */
export async function sharedGuild(
  client: ReturnType<typeof createClient>,
  owner: TestClient,
  member: TestClient,
  name = 'Test Guild',
) {
  const created = await client.call('POST', '/api/guilds', { token: owner.token, body: { name } });
  if (created.status !== 201) throw new Error(`guild create failed: ${JSON.stringify(created.body)}`);
  const guildId = created.body.guild.id as string;

  const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
  if (invite.status !== 201 && invite.status !== 200) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const code = (invite.body.invite?.code ?? invite.body.code) as string;

  const join = await client.call('POST', '/api/guilds/join', { token: member.token, body: { code } });
  if (join.status !== 200) throw new Error(`join failed: ${JSON.stringify(join.body)}`);

  return guildId;
}

/** Creates a voice channel (new guilds only ship a text one) and returns its id. */
export async function createVoiceChannel(
  client: ReturnType<typeof createClient>,
  owner: TestClient,
  guildId: string,
  name = `voz-${Math.random().toString(36).slice(2, 8)}`,
) {
  const res = await client.call('POST', `/api/guilds/${guildId}/channels`, {
    token: owner.token,
    body: { name, type: 'voice' },
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`voice channel failed: ${JSON.stringify(res.body)}`);
  return (res.body.channel?.id ?? res.body.id) as string;
}

export async function guildChannels(client: ReturnType<typeof createClient>, token: string, guildId: string) {
  const res = await client.call('GET', `/api/guilds/${guildId}`, { token });
  return res.body.guild.channels as { id: string; type: string; name: string }[];
}
