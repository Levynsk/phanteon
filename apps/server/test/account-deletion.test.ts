import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { config } = await import('../src/config/env');
const dataDir = config.dataDir;
const { db, schema } = await import('../src/db/client');
const { eq, or } = await import('drizzle-orm');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

async function upload(token: string, name = 'foto.png') {
  const form = new FormData();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
  form.append('file', new File([bytes], name, { type: 'image/png' }));
  const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return (await res.json()).attachment as { id: string; url: string };
}

const fileExists = (url: string) => Bun.file(join(dataDir, 'uploads', url.split('/').pop()!)).exists();

describe('account deletion (LGPD art. 18, VI)', () => {
  test('requires the username and the password', async () => {
    const user = await client.register();
    const wrongConfirm = await client.call('DELETE', '/api/auth/account', {
      token: user.token,
      body: { password: 'password123', confirm: 'outra-coisa' },
    });
    expect(wrongConfirm.status).toBe(400);

    const wrongPassword = await client.call('DELETE', '/api/auth/account', {
      token: user.token,
      body: { password: 'errada123', confirm: user.user.username },
    });
    expect(wrongPassword.status).toBe(401);
    expect((await client.call('GET', '/api/auth/me', { token: user.token })).status).toBe(200);
  });

  test('a server owner must hand the server over before deleting the account', async () => {
    const owner = await client.register();
    await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'Meu servidor' } });
    const res = await client.call('DELETE', '/api/auth/account', {
      token: owner.token,
      body: { password: 'password123', confirm: user(owner) },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('Passe a posse');
  });

  test('erases the e-mail, the hash, the profile images, the DMs and the uploaded files', async () => {
    const me = await client.register();
    const friend = await client.register();

    const avatar = await upload(me.token, 'avatar.png');
    const attachment = await upload(me.token, 'anexo.png');
    await client.call('PATCH', '/api/users/@me', {
      token: me.token,
      body: { avatarUrl: avatar.url, bio: 'dado pessoal', email: 'x' },
    });
    const dm = await client.call('POST', '/api/dms', { token: me.token, body: { userId: friend.user.id } });
    const channelId = dm.body.dm.id as string;
    await client.call('POST', `/api/channels/${channelId}/messages`, {
      token: me.token,
      body: { content: 'oi', attachmentIds: [attachment.id] },
    });
    await client.call('PUT', `/api/friends/${friend.user.id}/block`, { token: me.token });

    const summary = await client.call('GET', '/api/auth/account', { token: me.token });
    expect(summary.body.summary.messages).toBe(1);
    expect(summary.body.summary.attachments).toBe(2);

    const res = await client.call('DELETE', '/api/auth/account', {
      token: me.token,
      body: { password: 'password123', confirm: user(me) },
    });
    expect(res.status).toBe(200);

    // the account row (email, password hash, bio) is gone
    expect(db.select().from(schema.users).where(eq(schema.users.id, me.user.id)).get()).toBeUndefined();
    // and the session with it
    expect((await client.call('GET', '/api/auth/me', { token: me.token })).status).toBe(401);
    // nothing of theirs is left anywhere that points at the user id
    expect(db.select().from(schema.messages).where(eq(schema.messages.authorId, me.user.id)).all()).toHaveLength(0);
    expect(db.select().from(schema.attachments).where(eq(schema.attachments.uploaderId, me.user.id)).all()).toHaveLength(0);
    expect(db.select().from(schema.relationships).where(or(eq(schema.relationships.requesterId, me.user.id), eq(schema.relationships.addresseeId, me.user.id))).all()).toHaveLength(0);
    expect(db.select().from(schema.channelMembers).where(eq(schema.channelMembers.userId, me.user.id)).all()).toHaveLength(0);
    expect(db.select().from(schema.voiceStates).where(eq(schema.voiceStates.userId, me.user.id)).all()).toHaveLength(0);

    // uploaded files leave the disk too, including the avatar
    expect(await fileExists(attachment.url)).toBe(false);
    expect(await fileExists(avatar.url)).toBe(false);

    // the other side no longer has the conversation
    const dms = await client.call('GET', '/api/dms', { token: friend.token });
    expect(dms.body.dms.some((dm: { id: string }) => dm.id === channelId)).toBe(false);
  });

  test('an unknown account id never appears in responses', async () => {
    const me = await client.register();
    await client.call('DELETE', '/api/auth/account', { token: me.token, body: { password: 'password123', confirm: user(me) } });
    const search = await client.call('GET', `/api/users?q=${me.user.username}`, { token: (await client.register()).token });
    expect(search.body.users).toHaveLength(0);
    await mkdir(join(dataDir, 'uploads'), { recursive: true });
    const files = await readdir(join(dataDir, 'uploads'));
    expect(files.some((name) => name.startsWith(me.user.id))).toBe(false);
  });
});

function user(account: { user: { username: string } }) {
  return account.user.username;
}
