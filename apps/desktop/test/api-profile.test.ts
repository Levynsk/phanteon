import { afterEach, describe, expect, test } from 'bun:test';
import { api, configureApi, updateCachedUserProfile } from '../src/lib/api';
import { resolveApiUrlFrom } from '../src/lib/config';
import type { PublicUser } from '@phanteon/shared';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const user = (id: string, displayName: string, email?: string): PublicUser => ({
  id,
  username: id,
  displayName,
  email,
  avatarUrl: `/files/${displayName}.png?exp=300&sig=old`,
  bannerUrl: null,
  bio: null,
  accentColor: '#123456',
  status: 'online',
  createdAt: '2025-01-01T00:00:00.000Z',
});

configureApi({ getToken: () => 'token', onUnauthorized: () => undefined });
await resolveApiUrlFrom('http://api.test:3010');

function setDesktop(present: boolean) {
  (globalThis as { window?: unknown }).window = present ? { desktop: {} } : {};
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('channel message search API', () => {
  test('sends query and limit to the channel search endpoint', async () => {
    setDesktop(false);
    let requestUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }) as typeof fetch;

    await api.channels.searchMessages('channel-1', { query: 'hello world', limit: 12 });

    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/channels/channel-1/messages/search');
    expect(url.searchParams.get('q')).toBe('hello world');
    expect(url.searchParams.get('limit')).toBe('12');
  });
});

describe('user profile API cache', () => {
  test('deduplicates requests by user id and caches public aggregate data', async () => {
    setDesktop(false);
    let calls = 0;
    let finish!: (response: Response) => void;
    globalThis.fetch = (() => {
      calls += 1;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }) as typeof fetch;

    const first = api.users.profile('user-a');
    const second = api.users.profile('user-a');
    expect(calls).toBe(1);
    finish(new Response(JSON.stringify({ user: user('user-a', 'Alice', 'alice@test.local'), member: null }), { status: 200 }));
    const [profile, cached] = await Promise.all([first, second]);

    expect(profile.user?.displayName).toBe('Alice');
    expect(profile.user).not.toHaveProperty('email');
    expect(cached).toBe(profile);
    await api.users.profile('user-a');
    expect(calls).toBe(1);
  });

  test('profile updates replace cached avatar/banner URLs and clear private email', async () => {
    setDesktop(false);
    globalThis.fetch = (async () => new Response(JSON.stringify({
      user: user('user-b', 'Before', 'private@test.local'),
      member: null,
    }), { status: 200 })) as typeof fetch;
    await api.users.profile('user-b');

    const updated = user('user-b', 'After');
    updated.avatarUrl = '/files/new.png?exp=600&sig=fresh';
    updateCachedUserProfile(updated);
    const profile = await api.users.profile('user-b');

    expect(profile.user?.displayName).toBe('After');
    expect(profile.user?.avatarUrl).toBe('/files/new.png?exp=600&sig=fresh');
    expect(profile.user).not.toHaveProperty('email');
  });
});
