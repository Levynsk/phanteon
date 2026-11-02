import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const helper = join(import.meta.dir, '../dist-electron/audio-capture/pulse-capture');

describe('Pulse capture helper', () => {
  test('rejects unknown commands without connecting to PulseAudio', () => {
    const result = spawnSync(helper, ['unknown-command'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
  });

  test('lists active sink inputs as valid JSON without changing routing', () => {
    const result = spawnSync(helper, ['list'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const streams = JSON.parse(result.stdout) as { index: number; pid: number; name: string; binary: string }[];
    expect(Array.isArray(streams)).toBe(true);
    for (const stream of streams) {
      expect(Number.isInteger(stream.index)).toBe(true);
      expect(typeof stream.name).toBe('string');
      expect(typeof stream.binary).toBe('string');
    }
  });
});
