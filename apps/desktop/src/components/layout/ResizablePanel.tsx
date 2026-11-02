import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { PANEL_WIDTH, useUiStore, type ResizablePanelId } from '../../app/stores/ui';
import { cn } from '../../lib/cn';
import { resizePanelWidth } from '../../lib/panel-size';

/** Pointer travel that still counts as a click on the grip rather than a drag. */
const DRAG_SLOP = 2;
const STEP = 16;

/**
 * A right-hand panel the user can widen by dragging its inner edge, the one
 * facing the chat. The grip keeps a transparent 8px hit area so it is easy to
 * grab; the visible hairline only shows on hover, focus or while dragging.
 * Keyboard users resize with the arrow keys once the grip has focus.
 */
export function ResizablePanel({
  panel,
  label,
  resizeLabel,
  className,
  border = true,
  children,
  ...props
}: {
  panel: ResizablePanelId;
  /** Accessible name of the panel. */
  label: string;
  /** Accessible name of the resize grip. */
  resizeLabel: string;
  /** Separator against the chat; on by default, since every panel needs one. */
  border?: boolean;
  children?: ReactNode;
} & Omit<ComponentProps<'aside'>, 'aria-label'>) {
  const { min, max } = PANEL_WIDTH[panel];
  const width = useUiStore((state) => state.panelWidths[panel]);
  const setPanelWidth = useUiStore((state) => state.setPanelWidth);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  // the latest width without re-binding the drag listeners on every pixel
  const latest = useRef(width);
  latest.current = width;

  const resize = useCallback((next: number) => setPanelWidth(panel, next), [panel, setPanelWidth]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const origin = start.current;
      if (!origin) return;
      // a few pixels of wobble must not start a drag: short presses stay clicks
      if (Math.abs(event.clientX - origin.x) < DRAG_SLOP) return;
      resize(resizePanelWidth(origin.width, event.clientX - origin.x, min, max));
    };
    const stop = () => {
      start.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, min, max, resize]);

  // while dragging, nothing else on the page should select text or show a text cursor
  useEffect(() => {
    if (!dragging) return;
    const { userSelect, cursor } = document.body.style;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.userSelect = userSelect;
      document.body.style.cursor = cursor;
    };
  }, [dragging]);

  const nudge = (next: number) => resize(Math.min(max, Math.max(min, next)));

  return (
    <aside
      {...props}
      aria-label={label}
      className={cn('relative flex shrink-0 flex-col', border && 'border-l border-divider', className)}
      style={{ width, minWidth: min, maxWidth: max }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          start.current = { x: event.clientX, width: latest.current };
          setDragging(true);
        }}
        onKeyDown={(event) => {
          // arrows move the edge the pointer would: left widens a right-hand panel
          if (event.key === 'ArrowLeft') nudge(width + STEP);
          else if (event.key === 'ArrowRight') nudge(width - STEP);
          else if (event.key === 'Home') nudge(max);
          else if (event.key === 'End') nudge(min);
          else return;
          event.preventDefault();
        }}
        className={cn(
          // sits on the panel's own edge, so the ±4px come from the 8px hit area around it
          'absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none',
          // the hairline is the panel edge itself, thicker and in the brand colour while in use
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-[background-color,width]',
          dragging ? 'after:w-0.5 after:bg-brand' : 'after:bg-transparent hover:after:bg-line-strong focus-visible:after:w-0.5 focus-visible:after:bg-brand',
        )}
      />
      {children}
    </aside>
  );
}
