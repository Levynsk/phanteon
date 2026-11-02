import { describe, expect, test } from 'bun:test';
import { buildIceConfig } from '../src/services/ice-config';

/**
 * The ICE list is derived from the environment so relay credentials never live
 * in the repository.
 */
const TURN_URLS = 'turn:169.58.151.205:3478?transport=udp,turn:169.58.151.205:3478?transport=tcp';

describe('ice configuration', () => {
  test('adds the TURN relay from the environment, split into both transports', () => {
    const ice = buildIceConfig({
      STUN_URLS: 'stun:stun.l.google.com:19302',
      TURN_URLS,
      TURN_USERNAME: 'bloomy',
      TURN_CREDENTIAL: 'secret-value',
    });

    expect(ice.relayConfigured).toBe(true);
    expect(ice.iceServers[0]).toEqual({ urls: ['stun:stun.l.google.com:19302'] });
    expect(ice.iceServers[1]).toEqual({
      urls: ['turn:169.58.151.205:3478?transport=udp', 'turn:169.58.151.205:3478?transport=tcp'],
      username: 'bloomy',
      credential: 'secret-value',
    });
  });

  test('falls back to public STUN when no relay is configured', () => {
    const ice = buildIceConfig({});

    expect(ice.relayConfigured).toBe(false);
    expect(ice.iceServers).toEqual([{ urls: ['stun:stun.l.google.com:19302'] }]);
  });

  test('never exposes a half-configured relay', () => {
    // urls without credentials would make every peer connection fail
    const ice = buildIceConfig({ TURN_URLS, TURN_USERNAME: 'bloomy' });

    expect(ice.relayConfigured).toBe(false);
    expect(ice.iceServers).toHaveLength(1);
  });
});
