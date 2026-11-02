import { beforeAll, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { db, schema } = await import('../src/db/client');
const { joinGuildByInvite } = await import('../src/services/guilds');
const { banMember } = await import('../src/services/bans');
const { getUserRow } = await import('../src/services/users');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

function isMember(guildId: string, userId: string): boolean {
  return (
    db
      .select()
      .from(schema.guildMembers)
      .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId)))
      .get() !== undefined
  );
}

describe('invite redemption races', () => {
  test('a single-use invite admits exactly one of two concurrent joins', async () => {
    const owner = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, {
      token: owner.token,
      body: { maxUses: 1 },
    });
    const code = invite.body.invite.code as string;

    const first = await client.register();
    const second = await client.register();

    // both pass the "is it still redeemable?" read before either writes
    const results = await Promise.allSettled([
      Promise.resolve().then(() => joinGuildByInvite(getUserRow(first.user.id), code)),
      Promise.resolve().then(() => joinGuildByInvite(getUserRow(second.user.id), code)),
    ]);
    const admitted = [first, second].filter((user) => isMember(guildId, user.user.id));
    expect(admitted).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const row = db.select().from(schema.invites).where(eq(schema.invites.code, code)).get()!;
    expect(row.uses).toBe(1);
  });

  test('a ban that lands mid-join keeps the user out', async () => {
    const owner = await client.register();
    const target = await client.register();
    const guildId = await helpers.sharedGuild(client, owner, await client.register());
    const invite = await client.call('POST', `/api/guilds/${guildId}/invites`, { token: owner.token });
    const code = invite.body.invite.code as string;

    // the ban is committed before the top-level read, then the join proceeds
    banMember(owner.user.id, guildId, target.user.id, { reason: 'teste' });
    expect(() => joinGuildByInvite(getUserRow(target.user.id), code)).toThrow();
    expect(isMember(guildId, target.user.id)).toBe(false);
  });
});
