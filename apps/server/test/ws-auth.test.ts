import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

/** The websocket token must never travel in the URL, on either side. */
describe('websocket authentication', () => {
  test('server upgrades /ws without reading a token from the query', async () => {
    const source = await Bun.file(join(root, 'src/index.ts')).text();
    expect(source).not.toContain('searchParams.get(\'token\')');
    expect(source).not.toMatch(/url\.searchParams/);
  });

  test('client sends the token as the first frame', async () => {
    const clientSource = await Bun.file(join(root, '../../apps/desktop/src/lib/realtime.ts')).text();
    expect(clientSource).toContain("type: 'auth'");
    const config = await Bun.file(join(root, '../../apps/desktop/src/lib/config.ts')).text();
    const wsUrlFn = config.slice(config.indexOf('export function toWebSocketUrl'));
    expect(wsUrlFn.slice(0, 400)).not.toContain('searchParams');
  });
});
