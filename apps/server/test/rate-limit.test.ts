import { beforeAll, describe, expect, test } from 'bun:test';
import { useTempDataDir } from './helpers';

useTempDataDir();

const { createApp } = await import('../src/app');
const { migrate } = await import('../src/db/migrate');
const { LOGIN_RULES, UNFURL_RULE, rateLimits } = await import('../src/http/rate-limit');
const helpers = await import('./helpers');

const app = createApp();
const client = helpers.createClient(app);

beforeAll(() => {
  migrate();
});

async function login(identifier: string, password: string, ip = '10.0.0.1') {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ identifier, password }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

describe('login is not a guessing oracle', () => {
  test('unknown identifier and wrong password answer exactly the same', async () => {
    const user = await client.register();
    rateLimits.reset(`login:id:${user.user.username}`);
    rateLimits.reset('login:id:ninguem');

    const wrong = await login(user.user.username, 'errada123', '10.0.0.2');
    const unknown = await login('ninguem-existe', 'errada123', '10.0.0.3');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('a correct password clears the attempts for that account', async () => {
    const user = await client.register();
    await login(user.user.username, 'errada123', '10.0.0.4');
    const ok = await login(user.user.username, 'password123', '10.0.0.5');
    expect(ok.status).toBe(200);
    expect(rateLimits.hit(`login:id:${user.user.username}`, LOGIN_RULES.perIdentifier).allowed).toBe(true);
  });
});

describe('login rate limit', () => {
  test('an account is locked after too many failed attempts from any address', async () => {
    const user = await client.register();
    rateLimits.reset(`login:id:${user.user.username}`);
    for (let attempt = 0; attempt < LOGIN_RULES.perIdentifier.limit; attempt += 1) {
      const res = await login(user.user.username, 'errada123', `10.1.0.${attempt}`);
      expect(res.status).toBe(401);
    }
    // the correct password does not get through either until the window opens
    const blocked = await login(user.user.username, 'password123', '10.1.9.9');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('a client spraying many accounts is stopped', async () => {
    for (let attempt = 0; attempt < LOGIN_RULES.perClient.limit; attempt += 1) {
      rateLimits.reset(`login:id:alvo${attempt}`);
      await login(`alvo${attempt}`, 'errada123', '10.2.2.2');
    }
    rateLimits.reset('login:id:alvo-final');
    const blocked = await login('alvo-final', 'errada123', '10.2.2.2');
    expect(blocked.status).toBe(429);
  });
});

describe('link preview rate limit', () => {
  test('one user cannot make the server fetch pages without bound', async () => {
    const user = await client.register();
    for (let attempt = 0; attempt < UNFURL_RULE.limit; attempt += 1) {
      const res = await client.call('GET', '/api/unfurl?url=nope', { token: user.token });
      expect(res.status).toBe(400);
    }
    const blocked = await client.call('GET', '/api/unfurl?url=nope', { token: user.token });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
