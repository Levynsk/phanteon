import { beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { db, schema } = await import('../src/db/client');
const { newId } = await import('../src/db/ids');
const { RETENTION, purgeExpiredData, retentionPreview } = await import('../src/services/retention');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

const DAY = 24 * 60 * 60 * 1000;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('retention', () => {
  test('only unused, long-idle invites are removed', async () => {
    const owner = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: owner.token, body: { name: 'g' } });
    const guildId = guild.body.guild.id as string;
    const fresh = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token, body: {} });
    const idle = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token, body: {} });
    const used = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token, body: {} });

    const old = isoAgo((RETENTION.inviteIdleDays + 1) * DAY);
    db.update(schema.invites).set({ createdAt: old }).where(eq(schema.invites.code, idle.body.invite.code)).run();
    db.update(schema.invites).set({ createdAt: old, uses: 3 }).where(eq(schema.invites.code, used.body.invite.code)).run();

    const preview = retentionPreview();
    expect(preview.invites).toContain(idle.body.invite.code);
    expect(preview.invites).not.toContain(fresh.body.invite.code);

    const result = await purgeExpiredData();
    expect(result.invites).toBeGreaterThanOrEqual(1);
    const left = db.select().from(schema.invites).where(eq(schema.invites.guildId, guildId)).all().map((row) => row.code);
    expect(left).not.toContain(idle.body.invite.code);
    expect(left).toContain(fresh.body.invite.code);
    expect(left).toContain(used.body.invite.code);
  });

  test('an upload that never reached a message is removed after the retry window', async () => {
    const user = await client.register();
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1])], 'solto.png', { type: 'image/png' }));
    const res = await app.request('/api/uploads', { method: 'POST', headers: { authorization: `Bearer ${user.token}` }, body: form });
    const attachment = (await res.json()).attachment as { id: string };

    db.update(schema.attachments)
      .set({ createdAt: isoAgo((RETENTION.orphanUploadHours + 1) * 60 * 60 * 1000) })
      .where(eq(schema.attachments.id, attachment.id))
      .run();

    const result = await purgeExpiredData();
    expect(result.uploads).toBeGreaterThanOrEqual(1);
    expect(db.select().from(schema.attachments).where(eq(schema.attachments.id, attachment.id)).get()).toBeUndefined();
  });

  test('an attachment inside a message survives', async () => {
    const user = await client.register();
    const guild = await client.call('POST', '/api/guilds', { token: user.token, body: { name: 'g' } });
    const channel = (await helpers.guildChannels(client, user.token, guild.body.guild.id)).find((c) => c.type === 'text')!;
    const attachmentId = newId();
    db.insert(schema.attachments)
      .values({
        id: attachmentId,
        uploaderId: user.user.id,
        filename: 'antigo.png',
        mimeType: 'image/png',
        size: 1,
        url: `/files/${attachmentId}.png`,
        width: null,
        height: null,
        createdAt: isoAgo(10 * DAY),
      })
      .run();
    const message = await client.call('POST', `/api/channels/${channel.id}/messages`, {
      token: user.token,
      body: { content: 'com anexo', attachmentIds: [attachmentId] },
    });
    expect(message.status).toBe(201);

    // backdate both the upload and the message, then purge
    await purgeExpiredData();
    expect(db.select().from(schema.attachments).where(eq(schema.attachments.id, attachmentId)).get()).toBeDefined();
  });
});
