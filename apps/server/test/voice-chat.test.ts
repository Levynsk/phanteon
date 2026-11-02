import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

/**
 * The voice channel page shows a chat of its own, so a voice channel must hold
 * and serve messages like any other channel instead of borrowing a text one.
 */
useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

describe('voice channel chat', () => {
  test('stores messages in the voice channel itself and not in the text channel', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, owner);
    const voiceId = await helpers.createVoiceChannel(client, owner, guildId);
    const textChannel = (await helpers.guildChannels(client, owner.token, guildId)).find(
      (channel) => channel.type === 'text',
    )!;

    const sent = await client.call('POST', `/api/channels/${voiceId}/messages`, {
      token: owner.token,
      body: { content: 'fala pessoal' },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.message.channelId).toBe(voiceId);

    const voicePage = await client.call('GET', `/api/channels/${voiceId}/messages`, { token: owner.token });
    expect(voicePage.status).toBe(200);
    expect(voicePage.body.messages.map((message: { content: string }) => message.content)).toEqual(['fala pessoal']);

    // the text channel stays empty: the two chats are independent
    const textPage = await client.call('GET', `/api/channels/${textChannel.id}/messages`, { token: owner.token });
    expect(textPage.status).toBe(200);
    expect(textPage.body.messages).toEqual([]);
  });

  test('two voice channels keep their own history', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, owner);
    const first = await helpers.createVoiceChannel(client, owner, guildId, 'lobby');
    const second = await helpers.createVoiceChannel(client, owner, guildId, 'sala-2');

    await client.call('POST', `/api/channels/${first}/messages`, { token: owner.token, body: { content: 'no lobby' } });
    await client.call('POST', `/api/channels/${second}/messages`, { token: owner.token, body: { content: 'na sala 2' } });

    const firstPage = await client.call('GET', `/api/channels/${first}/messages`, { token: owner.token });
    const secondPage = await client.call('GET', `/api/channels/${second}/messages`, { token: owner.token });

    expect(firstPage.body.messages.map((message: { content: string }) => message.content)).toEqual(['no lobby']);
    expect(secondPage.body.messages.map((message: { content: string }) => message.content)).toEqual(['na sala 2']);
  });
});
