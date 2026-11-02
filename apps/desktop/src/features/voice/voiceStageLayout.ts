import type { AvatarSize } from '../../components/ui/Avatar';

export type TileSize = 'sm' | 'md' | 'lg' | 'xl';

export const AVATAR_FOR: Record<TileSize, AvatarSize> = { sm: 'sm', md: 'md', lg: 'lg', xl: 'xl' };

export interface StageLayout {
  focus: { width: number; height: number };
  focusSize: TileSize;
  grid: { gap: number };
  columns: number;
  gridSize: { width: number; height: number; avatar: TileSize };
}

export const STAGE_GAP = 8;
/** A lone tile never takes more width than this, so 16:9 stays close to the natural stage. */
export const MAX_SOLO_WIDTH = 1100;
/** The stage never fills more than this share of its height, whatever the call size. */
const MAX_STAGE_HEIGHT_RATIO = 0.7;

/**
 * Size limits for the block that holds every tile: a wide window shouldn't
 * stretch one person across the screen, and the cards stop growing past ~70% of
 * the height. When the area is already smaller than that, the area wins — the
 * cap only trims growth, it never cuts a tile that would not fit.
 */
export function stageCaps(width: number, height: number) {
  const maxWidth = Math.min(1120, width);
  // below 560px tall the cards keep their full share: at that size they are already small
  const maxHeight = height < 560 ? height : Math.round(height * MAX_STAGE_HEIGHT_RATIO);
  return { maxWidth, maxHeight };
}

/** Cards and the spotlight scale with the space they actually got, cards a bit more conservatively. */
export function avatarFor(tileHeight: number, card = false): TileSize {
  if (tileHeight >= (card ? 420 : 340)) return 'xl';
  if (tileHeight >= (card ? 220 : 200)) return 'lg';
  if (tileHeight >= (card ? 120 : 104)) return 'md';
  return 'sm';
}

/**
 * Packs tiles 16:9 into the measured stage. With someone in focus the spotlight
 * takes the top ~70% (capped so it never becomes a lone slab) and the rest sit in
 * rows below; without focus everyone shares the whole area, and the search picks
 * the arrangement that uses the space with tiles as close to their aspect as the
 * space allows.
 */
export function layoutStage({
  width,
  height,
  hasFocus,
  restCount,
  spotlit = false,
}: {
  width: number;
  height: number;
  hasFocus: boolean;
  restCount: number;
  /** Someone was deliberately brought forward (not a screen share): they deserve most of the stage. */
  spotlit?: boolean;
}): StageLayout | null {
  if (width <= 0 || height <= 0) return null;
  // the cap only limits how big tiles get, it never forces a size the area cannot hold
  const cap = stageCaps(width, height);
  width = Math.min(width, cap.maxWidth);
  height = Math.min(height, cap.maxHeight);
  const focusShare = spotlit ? 0.8 : 0.7;
  // the spotlight keeps ~70% (80% for a deliberate pick), giving up height only when its 16:9 width would
  // not fit; the row below always keeps at least 96px so the cards never collapse
  const focusBudget =
    hasFocus && restCount > 0 ? Math.min(Math.max(height * focusShare, Math.floor((width * 9) / 16)), height - 96) : height;
  const gridBudget = hasFocus ? Math.max(96, height - focusBudget - STAGE_GAP) : height;

  // spotlight alone: one big tile, but never wider than its 16:9 height allows
  if (hasFocus && restCount === 0) {
    const solo = packGrid({ width, height, count: 1 });
    return {
      focus: { width: solo.width, height: solo.height },
      focusSize: avatarFor(solo.height),
      grid: { gap: STAGE_GAP },
      columns: 1,
      gridSize: { width: 0, height: 0, avatar: 'md' },
    };
  }

  if (!hasFocus) {
    const layout = packGrid({ width, height, count: restCount || 1 });
    return {
      focus: { width: 0, height: 0 },
      focusSize: 'md',
      grid: { gap: STAGE_GAP },
      columns: layout.columns,
      gridSize: { width: layout.width, height: layout.height, avatar: avatarFor(layout.height, true) },
    };
  }

  let focusWidth = Math.min(Math.floor(focusBudget * (16 / 9)), width, MAX_SOLO_WIDTH);
  focusWidth -= focusWidth % 2;
  const focusHeight = Math.min(focusBudget, Math.floor(focusWidth * (9 / 16)));
  // whatever stays below the focus fills the rest of the height as far as its own aspect allows
  const layout = packGrid({ width, height: gridBudget, count: restCount, fitHeight: true });

  return {
    focus: { width: focusWidth, height: focusHeight },
    focusSize: avatarFor(focusHeight),
    grid: { gap: STAGE_GAP },
    columns: layout.columns,
    gridSize: { width: layout.width, height: layout.height, avatar: avatarFor(layout.height, true) },
  };
}

/**
 * Picks the column count that fills the most of the box. Discards arrangements
 * where a row would be too tall to fit or a tile would stop reading as a video
 * card, then prefers the one whose tiles hug 16:9 most closely.
 */
export function packGrid({
  width,
  height,
  count,
  fitHeight = false,
}: {
  width: number;
  height: number;
  count: number;
  /** Rows below a spotlight may grow past 16:9 to use the leftover height instead of leaving a gap. */
  fitHeight?: boolean;
}) {
  let best: { columns: number; width: number; height: number; area: number } | null = null;
  for (let columns = 1; columns <= Math.min(count, 8); columns++) {
    const rows = Math.ceil(count / columns);
    const byWidth = Math.floor((width - (columns - 1) * STAGE_GAP) / columns);
    const byHeight = Math.floor((height - (rows - 1) * STAGE_GAP) / rows);
    let tileWidth: number;
    let tileHeight: number;
    if (fitHeight) {
      // fill the row height, but never past 21:9 (row cards stay horizontal, not square)
      tileHeight = Math.max(0, byHeight);
      tileWidth = Math.min(byWidth, Math.floor(tileHeight * (21 / 9)));
      tileHeight = Math.min(tileHeight, Math.floor(tileWidth * (9 / 16)));
    } else {
      // tiles keep 16:9; never let one be taller than roughly one row of the box
      tileWidth = Math.min(byWidth, Math.floor(byHeight * (16 / 9)));
      tileHeight = Math.floor(tileWidth * (9 / 16));
    }
    if (tileWidth <= 0 || tileHeight <= 0) continue;
    if (!best || tileWidth * tileHeight > best.area) {
      best = { columns, width: tileWidth, height: tileHeight, area: tileWidth * tileHeight };
    }
  }
  return best ?? { columns: 1, width, height };
}


