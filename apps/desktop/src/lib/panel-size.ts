/**
 * Width of a side panel dragged by its inner edge. A panel anchored to the
 * right edge grows when the pointer moves left, so the delta is inverted.
 */
export function resizePanelWidth(start: number, dx: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(start - dx)));
}

/** No panel should ever take more than this share of the window, whatever the saved width says. */
export function clampPanelWidth(width: number, viewport: number, min = 160, share = 0.6): number {
  const max = Math.max(min, Math.round(viewport * share));
  return Math.min(max, Math.max(min, Math.round(width)));
}
