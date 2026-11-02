import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Hairline window-control glyphs: sharp at 10px, where lucide icons turn muddy. */
function glyphClass(extra?: string) {
  return cn('pointer-events-none', extra);
}

export function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" className={glyphClass('size-2.5')} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M1 5h8" />
    </svg>
  );
}

export function MaximizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" className={glyphClass('size-2.5')} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" />
    </svg>
  );
}

/** Two offset frames read as "restore" at any zoom, unlike the usual single square. */
export function RestoreGlyph() {
  return (
    <svg viewBox="0 0 10 10" className={glyphClass('size-2.5')} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M3 2.5h5.5a.5.5 0 0 1 .5.5V8" />
      <rect x="1" y="3.5" width="6" height="5.5" rx="0.5" fill="var(--color-surface-alt)" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg viewBox="0 0 10 10" className={glyphClass('size-2.5')} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
    </svg>
  );
}

export function WindowButton({
  label,
  children,
  onClick,
  danger,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex w-11 items-center justify-center text-muted transition-colors hover:bg-black/10 hover:text-heading',
        danger && 'hover:bg-red hover:text-on-brand',
      )}
    >
      {children}
    </button>
  );
}
