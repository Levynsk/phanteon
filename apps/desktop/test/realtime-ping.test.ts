import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

/**
 * The dock shows the round-trip time to the server while in a call, so the
 * measurement has to be real: this drives the shipping client against a local
 * socket that answers `pong`.
 *
 * The client derives its URL from the API base, so the test picks a free port
 * and points the client there — it never depends on a dev server being down.
 */
type Server = ReturnType<typeof Bun.serve>;

let server: Server;
let client: { connect(): void; disconnect(): void; ping(): number | null; onPing(cb: (ms: number | null) => void): () => void };

beforeAll(async () => {
  server = Bun.serve({
    // 0 = let the OS pick a free port
    port: 0,
    fetch(request, srv) {
      if (srv.upgrade(request)) return undefined;
      return new Response('not found', { status: 404 });
    },
    websocket: {
      message(socket, raw) {
        const event = JSON.parse(String(raw)) as { type: string };
        if (event.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      },
    },
  });
  // the API base is resolved once; point it at the throwaway server first
  const config = await import('../src/lib/config');
  await config.resolveApiUrlFrom(`http://localhost:${server.port}`);
  const { RealtimeClient } = await import('../src/lib/realtime');
  const instance = new RealtimeClient();
  client = {
    connect: () => instance.connect('test-token'),
    disconnect: () => instance.disconnect(),
    ping: () => instance.ping(),
    onPing: (cb) => instance.onPing(cb),
  };
}, 15000);

afterAll(() => {
  client?.disconnect();
  server?.stop(true);
});

describe('realtime ping', () => {
  test('measures the round trip from the heartbeat and clears it on disconnect', async () => {
    const readings: (number | null)[] = [];
    client.onPing((ms) => readings.push(ms));

    client.connect();
    await Bun.sleep(300);

    const measured = client.ping();
    expect(measured).not.toBeNull();
    expect(measured!).toBeGreaterThanOrEqual(0);
    expect(measured!).toBeLessThan(1000);

    client.disconnect();
    await Bun.sleep(100);

    expect(client.ping()).toBeNull();
    expect(readings.at(-1)).toBeNull();
  });
});
