import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { hub } = await import('../src/realtime/hub');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

describe('profile updates never carry the e-mail to unrelated people', () => {
  test('the public user payload has no e-mail field at all', async () => {
    const me = await client.register();
    const other = await client.register();
    const res = await client.call('GET', `/api/users/${me.user.id}`, { token: other.token });
    expect(Object.keys(res.body.user)).not.toContain('email');
    expect(JSON.stringify(res.body)).not.toContain('@test.local');
    expect(JSON.stringify(res.body)).not.toContain('email');
  });

  test('the user:update event sent to a guild peer has no e-mail', async () => {
    const owner = await client.register();
    const member = await client.register();
    await helpers.sharedGuild(client, owner, member);

    // the fan-out is what leaks; capture what each recipient receives
    const captured: { to: string[]; event: { type: string; user?: { email?: string } } }[] = [];
    // Bun's test transpiler drops method-to-property assignments, so tap the prototype
    const proto = Object.getPrototypeOf(hub) as { emitToUsers: typeof hub.emitToUsers };
    const original = proto.emitToUsers;
    proto.emitToUsers = function (this: unknown, userIds, event) {
      captured.push({ to: [...userIds], event: event as never });
      return original.call(this, userIds, event);
    };
    try {
      const updated = await client.call('PATCH', '/api/users/@me', {
        token: member.token,
        body: { displayName: 'Novo nome' },
      });
      // the response to the caller is the private view and does carry the e-mail
      expect(typeof updated.body.user.email).toBe('string');
    } finally {
      proto.emitToUsers = original;
    }

    const profileEvents = captured.filter((entry) => entry.event.type === 'user:update');
    expect(profileEvents.length).toBeGreaterThan(0);
    for (const entry of profileEvents) {
      const sharesOwner = entry.to.includes(owner.user.id);
      const sharesMember = entry.to.includes(member.user.id);
      if (sharesOwner && !sharesMember) {
        // the peer receives the public view only
        expect(entry.event.user?.email).toBeUndefined();
      }
      if (sharesMember && sharesOwner) {
        // one fan-out carrying both can only be right when the e-mail is stripped for the peer
        expect(entry.event.user?.email).toBeUndefined();
      }
    }
  });
});
