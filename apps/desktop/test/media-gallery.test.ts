import { describe, expect, test } from 'bun:test';
import { clampZoom, gridShape, isZoomed, MAX_ZOOM, MIN_ZOOM, stepIndex, ZOOM_STEP } from '../src/lib/media-gallery';

describe('stepIndex', () => {
  test('moves forward and backward', () => {
    expect(stepIndex(0, 1, 7)).toBe(1);
    expect(stepIndex(3, -1, 7)).toBe(2);
  });

  test('wraps around both ends', () => {
    expect(stepIndex(6, 1, 7)).toBe(0);
    expect(stepIndex(0, -1, 7)).toBe(6);
    expect(stepIndex(1, 5, 3)).toBe(0);
    expect(stepIndex(2, -4, 3)).toBe(1);
  });

  test('an empty gallery always resolves to 0', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(stepIndex(4, -1, 0)).toBe(0);
    expect(stepIndex(0, 1, -3)).toBe(0);
  });

  test('a single item never moves', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });

  test('invalid input does not escape the range', () => {
    expect(stepIndex(Number.NaN, 1, 5)).toBe(1);
    expect(stepIndex(0, Number.NaN, 5)).toBe(0);
    expect(stepIndex(0, 1, Number.NaN)).toBe(0);
    expect(stepIndex(Number.POSITIVE_INFINITY, 1, 5)).toBe(1);
    expect(stepIndex(99, 0, 5)).toBe(4);
    expect(stepIndex(-99, 0, 5)).toBe(1);
    for (let i = -12; i <= 12; i += 1) {
      const next = stepIndex(i, i * 3, 5);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(5);
    }
  });
});

describe('zoom', () => {
  test('defaults span fit to 4x', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(2.25)).toBe(2.25);
  });

  test('honours custom bounds and float noise', () => {
    expect(clampZoom(1.23456, 1, 2)).toBe(1.23);
    expect(clampZoom(-5, 0.5, 3)).toBe(0.5);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(ZOOM_STEP + 2 * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM)).toBe(1.5);
  });

  test('only values above 1x count as zoomed', () => {
    expect(isZoomed(1)).toBe(false);
    expect(isZoomed(1 + 1e-9)).toBe(false);
    expect(isZoomed(1.05)).toBe(true);
    expect(isZoomed(4)).toBe(true);
    expect(isZoomed(Number.NaN)).toBe(false);
  });
});

describe('gridShape', () => {
  const expected: Array<[number, number, number, 'none' | 'wide' | 'tall']> = [
    [1, 1, 1, 'none'],
    [2, 2, 1, 'none'],
    [3, 2, 2, 'wide'],
    [4, 2, 2, 'none'],
    [5, 3, 2, 'tall'],
    [6, 3, 2, 'none'],
    [7, 4, 2, 'none'],
    [8, 4, 2, 'none'],
    [9, 4, 3, 'none'],
    [10, 4, 3, 'none'],
  ];

  test.each(expected)('%i items lay out in %ix%i (%s lead)', (count, columns, rows, lead) => {
    expect(gridShape(count)).toEqual({ columns, rows, lead });
  });

  test('never exceeds four columns', () => {
    for (let count = 0; count <= 40; count += 1) {
      const { columns, rows } = gridShape(count);
      expect(columns).toBeLessThanOrEqual(4);
      expect(columns * rows).toBeGreaterThanOrEqual(count);
      expect(rows).toBe(Math.max(1, Math.ceil(count / columns)));
    }
  });

  test('the lead tile keeps its cell count exact', () => {
    expect(gridShape(3).columns * gridShape(3).rows).toBe(4);
    expect(gridShape(5).columns * gridShape(5).rows).toBe(6);
  });

  test('an empty or invalid gallery still reports a frame', () => {
    expect(gridShape(0)).toEqual({ columns: 1, rows: 1, lead: 'none' });
    expect(gridShape(Number.NaN)).toEqual({ columns: 1, rows: 1, lead: 'none' });
  });
});
