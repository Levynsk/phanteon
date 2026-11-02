/** Lowest zoom level: the image fits the viewer. */
export const MIN_ZOOM = 1;
/** Highest zoom level the viewer offers, in "2x" steps from 1x. */
export const MAX_ZOOM = 4;
/** Zoom applied by one wheel notch or click. */
export const ZOOM_STEP = 0.5;
/** Slack for zoom values that come back from floating-point arithmetic. */
const ZOOM_EPSILON = 1e-6;

/**
 * Steps through a list and wraps around at both ends. A non-positive count and
 * non-finite inputs all collapse to 0 so callers never index out of bounds.
 */
export function stepIndex(index: number, delta: number, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  const size = Math.floor(count);
  const shift = Number.isFinite(delta) ? Math.round(delta) : 0;
  const from = Number.isFinite(index) ? Math.round(index) : 0;
  return (((from + shift) % size) + size) % size;
}

/** Keeps a zoom factor between `min` and `max`, rounding to hundredths. */
export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  if (!Number.isFinite(zoom)) return low;
  return Math.min(high, Math.max(low, Math.round(zoom * 100) / 100));
}

/** Whether the image is larger than its fitted size and therefore pannable. */
export function isZoomed(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom > MIN_ZOOM + ZOOM_EPSILON;
}

export type GridLead = 'none' | 'wide' | 'tall';

export interface GridShape {
  columns: number;
  rows: number;
  /** The first tile stretches across two columns (`wide`) or two rows (`tall`). */
  lead: GridLead;
}

/**
 * Discord-style attachment layout, capped at four columns:
 *
 * - 1 => 1x1
 * - 2 => 2x1
 * - 3 => 2x2, first tile wide on top, the other two side by side below
 * - 4 => 2x2
 * - 5 => 3x2, first tile tall on the left, the other four in a 2x2 on the right
 * - 6 => 3x2
 * - 7-8 => 4x2
 * - 9+ => 4 columns, as many rows as needed
 *
 * An empty gallery still reports a 1x1 frame so callers can divide by it.
 */
export function gridShape(count: number): GridShape {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (total <= 1) return { columns: 1, rows: 1, lead: 'none' };
  switch (total) {
    case 2:
      return { columns: 2, rows: 1, lead: 'none' };
    case 3:
      return { columns: 2, rows: 2, lead: 'wide' };
    case 4:
      return { columns: 2, rows: 2, lead: 'none' };
    case 5:
      return { columns: 3, rows: 2, lead: 'tall' };
    case 6:
      return { columns: 3, rows: 2, lead: 'none' };
    case 7:
    case 8:
      return { columns: 4, rows: 2, lead: 'none' };
    default: {
      const columns = 4;
      return { columns, rows: Math.ceil(total / columns), lead: 'none' };
    }
  }
}
