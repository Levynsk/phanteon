import { describe, expect, test } from 'bun:test';
import { canRelaySignal } from '../src/realtime/hub';

const rosters: Record<string, Record<string, string>> = {
  call: { alice: 'voz-1', bob: 'voz-1', carol: 'voz-2', dave: '' },
};

const channelOf = (user: string) => (userId: string) => rosters[user]?.[userId] || null;

describe('voice signalling relay', () => {
  test('relays between two members of the same channel', () => {
    expect(canRelaySignal(channelOf('call'), 'alice', 'bob', 'voz-1')).toBe(true);
    expect(canRelaySignal(channelOf('call'), 'bob', 'alice', 'voz-1')).toBe(true);
  });

  test('rejects a sender that is not in the claimed channel', () => {
    expect(canRelaySignal(channelOf('call'), 'carol', 'alice', 'voz-1')).toBe(false);
    expect(canRelaySignal(channelOf('call'), 'dave', 'alice', 'voz-1')).toBe(false);
  });

  test('rejects a target that is elsewhere or not in voice', () => {
    expect(canRelaySignal(channelOf('call'), 'alice', 'carol', 'voz-1')).toBe(false);
    expect(canRelaySignal(channelOf('call'), 'alice', 'dave', 'voz-1')).toBe(false);
    expect(canRelaySignal(channelOf('call'), 'alice', 'ghost', 'voz-1')).toBe(false);
  });

  test('rejects self-signals and spoofed channel ids', () => {
    expect(canRelaySignal(channelOf('call'), 'alice', 'alice', 'voz-1')).toBe(false);
    expect(canRelaySignal(channelOf('call'), 'alice', 'bob', 'outro-canal')).toBe(false);
  });
});
