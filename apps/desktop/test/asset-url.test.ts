import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { ACCESS_TOKEN_PARAM, assetUrl, toRemoteUrl } from '../src/lib/asset-url';
import { resolveApiUrlFrom } from '../src/lib/config';

/** The renderer sees `window.desktop` only inside Electron; the tests toggle it. */
const originalWindow = globalThis.window;

function setDesktop(present: boolean) {
  (globalThis as { window?: unknown }).window = present ? { desktop: {} } : {};
}

const API = 'http://api.test:3010';

beforeAll(async () => {
  // the API base is resolved once at boot; pin it so the test does not depend on the build
  await resolveApiUrlFrom(API);
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe('asset URLs', () => {
  test('a relative /files path is resolved against the API', () => {
    setDesktop(false);
    expect(assetUrl('/files/a.png')).toBe(`${API}/files/a.png`);
  });

  test('local previews pass through untouched', () => {
    setDesktop(true);
    expect(assetUrl('blob:http://x/y')).toBe('blob:http://x/y');
    expect(assetUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(assetUrl(null)).toBeUndefined();
  });

  test('inside Electron the page origin is rewritten and the token rides along', () => {
    setDesktop(true);
    const url = assetUrl('http://api.test:3010/files/a.png?exp=1&sig=abc', { token: 'jwt' });
    expect(url).toBe(`remote://api.test_3010/files/a.png?exp=1&sig=abc&${ACCESS_TOKEN_PARAM}=jwt`);
  });

  test('a port survives the rewrite (standard schemes would drop it)', () => {
    expect(toRemoteUrl('http://127.0.0.1:4000/files/a.png')).toBe('remote://127.0.0.1_4000/files/a.png');
    expect(toRemoteUrl('https://api.example.com/files/a.png')).toBe('remote://api.example.com/files/a.png');
  });

  test('without a token no access_token is added', () => {
    setDesktop(true);
    expect(assetUrl('http://api.test:3010/files/a.png')).not.toContain(ACCESS_TOKEN_PARAM);
  });
});
