import { describe, expect, test } from 'bun:test';
import { formatTime, progressOf, seekTarget, volumeIconLevel } from '../src/lib/video-controls';

describe('formatTime', () => {
  test('shows minutes and padded seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(7)).toBe('0:07');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(599)).toBe('9:59');
  });

  test('adds the hour once the media passes 59:59', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(86399)).toBe('23:59:59');
  });

  test('floors fractions of a second', () => {
    expect(formatTime(9.99)).toBe('0:09');
  });

  test('falls back to 0:00 for invalid input', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(-Infinity)).toBe('0:00');
  });
});

describe('seekTarget', () => {
  test('moves by the delta', () => {
    expect(seekTarget({ duration: 120, currentTime: 30 }, 5)).toBe(35);
    expect(seekTarget({ duration: 120, currentTime: 30 }, -5)).toBe(25);
  });

  test('clamps to the media bounds', () => {
    expect(seekTarget({ duration: 120, currentTime: 2 }, -5)).toBe(0);
    expect(seekTarget({ duration: 120, currentTime: 118 }, 5)).toBe(120);
  });

  test('ignores invalid durations and keeps a sane position', () => {
    expect(seekTarget({ duration: NaN, currentTime: 42 }, 5)).toBe(42);
    expect(seekTarget({ duration: Infinity, currentTime: 42 }, 5)).toBe(42);
    expect(seekTarget({ duration: 0, currentTime: 42 }, 5)).toBe(42);
    expect(seekTarget({ duration: -10, currentTime: 42 }, 5)).toBe(42);
  });

  test('sanitises an invalid current position', () => {
    expect(seekTarget({ duration: 120, currentTime: NaN }, 5)).toBe(5);
    expect(seekTarget({ duration: 120, currentTime: -30 }, 5)).toBe(5);
    expect(seekTarget({ duration: NaN, currentTime: NaN }, 5)).toBe(0);
  });
});

describe('progressOf', () => {
  test('maps the position onto 0..1', () => {
    expect(progressOf(0, 100)).toBe(0);
    expect(progressOf(25, 100)).toBe(0.25);
    expect(progressOf(100, 100)).toBe(1);
    expect(progressOf(150, 100)).toBe(1);
  });

  test('is 0 when the duration is not usable', () => {
    expect(progressOf(10, 0)).toBe(0);
    expect(progressOf(10, NaN)).toBe(0);
    expect(progressOf(10, Infinity)).toBe(0);
    expect(progressOf(10, -100)).toBe(0);
    expect(progressOf(NaN, 100)).toBe(0);
  });
});

describe('volumeIconLevel', () => {
  test('muted always wins', () => {
    expect(volumeIconLevel(1, true)).toBe('muted');
    expect(volumeIconLevel(0, true)).toBe('muted');
  });

  test('splits loud and quiet levels in the middle', () => {
    expect(volumeIconLevel(1, false)).toBe('high');
    expect(volumeIconLevel(0.5, false)).toBe('high');
    expect(volumeIconLevel(0.49, false)).toBe('low');
    expect(volumeIconLevel(0, false)).toBe('low');
    expect(volumeIconLevel(NaN, false)).toBe('low');
  });
});
