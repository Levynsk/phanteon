import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { config } = await import('../src/config/env');
const { signFileUrl, signedFilePath, verifyFileSignature, FILE_URL_TTL_SECONDS } = await import('../src/services/file-links');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);

async function upload(token: string, name = 'foto.png') {
  const form = new FormData();
  form.append('file', new File([bytes], name, { type: 'image/png' }));
  const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return (await res.json()).attachment as { id: string; url: string };
}

const filePath = (url: string) => `/files/${url.split('/').pop()!.split('?')[0]}`;
const fileName = (url: string) => url.split('/').pop()!.split('?')[0]!;

async function get(path: string, token?: string) {
  return app.request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function send(token: string, channelId: string, attachmentId: string) {
  return client.call('POST', `/api/channels/${channelId}/messages`, { token, body: { content: '', attachmentIds: [attachmentId] } });
}

async function textChannel(ownerToken: string, guildId: string) {
  return (await helpers.guildChannels(client, ownerToken, guildId)).find((channel) => channel.type === 'text')!;
}

describe('file links are signed and short-lived', () => {
  test('a signature names one file, one expiry, and nothing else', () => {
    const now = Date.now();
    const { exp, sig } = signFileUrl('segredo', 'a.png', now);
    expect(verifyFileSignature('segredo', 'a.png', { exp, sig }, now)).toBe(true);
    expect(verifyFileSignature('segredo', 'b.png', { exp, sig }, now)).toBe(false);
    expect(verifyFileSignature('outro', 'a.png', { exp, sig }, now)).toBe(false);
    expect(verifyFileSignature('segredo', 'a.png', { exp, sig }, now + FILE_URL_TTL_SECONDS * 1000 + 1)).toBe(false);
    expect(verifyFileSignature('segredo', 'a.png', { exp: exp, sig: 'x' }, now)).toBe(false);
  });

  test('only /files paths get signed', () => {
    expect(signedFilePath('segredo', '/files/a.png')).toStartWith('/files/a.png?exp=');
    expect(signedFilePath('segredo', '/avatars/a.png')).toBe('/avatars/a.png');
    expect(signedFilePath('segredo', null)).toBeNull();
  });
});

describe('/files requires a session and the right to the file', () => {
  test('an anonymous request is refused', async () => {
    const user = await client.register();
    const file = await upload(user.token);
    expect((await get(filePath(file.url))).status).toBe(401);
  });

  test('a member who can see the message can load the file without a signature', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const channel = await textChannel(owner.token, guildId);
    const file = await upload(owner.token);
    const message = await send(owner.token, channel.id, file.id);
    expect(message.status).toBe(201);

    const res = await get(filePath(file.url), member.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('private');
  });

  test('someone outside the server cannot load it, even knowing the name', async () => {
    const owner = await client.register();
    const outsider = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'g' } });
    const channel = await textChannel(owner.token, guild.body.guild.id);
    const file = await upload(owner.token);
    await send(owner.token, channel.id, file.id);

    const res = await get(filePath(file.url), outsider.token);
    expect(res.status).toBe(404);
  });

  test('the uploader keeps access before the message exists', async () => {
    const user = await client.register();
    const file = await upload(user.token);
    expect((await get(filePath(file.url), user.token)).status).toBe(200);
  });

  test('a valid signature authorises a session for one file, and expires', async () => {
    const owner = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'g' } });
    const channel = await textChannel(owner.token, guild.body.guild.id);
    const file = await upload(owner.token);
    await send(owner.token, channel.id, file.id);

    const stranger = await client.register();
    const { exp, sig } = signFileUrl(config.fileLinkSecret, fileName(file.url));
    // a session is always required; the signature lets a session without channel access take THIS file
    expect((await get(`${filePath(file.url)}?exp=${exp}&sig=${sig}`, stranger.token)).status).toBe(200);
    expect((await get(`${filePath(file.url)}`, stranger.token)).status).toBe(404);

    const tampered = await get(`${filePath(file.url)}?exp=${exp}&sig=${sig}x`, stranger.token);
    expect(tampered.status).toBe(404);
    // and without a session the signature alone is not enough
    expect((await get(`${filePath(file.url)}?exp=${exp}&sig=${sig}`)).status).toBe(401);
  });

  test('the attachment URL the API returns is already signed', async () => {
    const owner = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'g' } });
    const channel = await textChannel(owner.token, guild.body.guild.id);
    const file = await upload(owner.token);
    const message = await send(owner.token, channel.id, file.id);
    const url = message.body.message.attachments[0].url as string;
    expect(url).toContain('sig=');

    const res = await app.request(new URL(url).pathname + new URL(url).search, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(res.status).toBe(200);
  });

  test('a voice channel does not hand out files: joining the call is not reading chat', async () => {
    const owner = await client.register();
    const member = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, member);
    const voice = await helpers.createVoiceChannel(client, owner, guildId);
    const file = await upload(owner.token);
    await send(owner.token, voice, file.id);

    expect((await get(filePath(file.url), member.token)).status).toBe(404);
    // the owner still sees their own upload
    expect((await get(filePath(file.url), owner.token)).status).toBe(200);
  });

  test('guild icons stay visible to signed-in members only', async () => {
    const user = await client.register();
    const form = new FormData();
    form.append('kind', 'x');
    // write a guild-like image through the upload route is not needed: the file is stored by name
    const { saveGuildImage } = await import('../src/services/uploads');
    const path = await saveGuildImage(new File([bytes], 'icon.png', { type: 'image/png' }), 'icon');
    expect((await get(path, user.token)).status).toBe(200);
    expect((await get(path)).status).toBe(401);
  });
});
