import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

const frameVariants = {
  /** Boxed field with its own border, used inside settings panels. */
  boxed: 'h-9 rounded-sm border border-divider bg-app-alt px-2.5 focus-within:ring-2 focus-within:ring-brand',
  /** Bare field that sits on a surface which already has its own padding. */
  plain: 'h-7 rounded-sm border-0 bg-app px-2',
} as const;

interface SearchInputProps extends Omit<ComponentProps<'input'>, 'size' | 'type'> {
  /** `aria-label` is required: the field has no visible label. */
  'aria-label': string;
  variant?: keyof typeof frameVariants;
  /** Small counter or clear button shown at the right edge. */
  aside?: ReactNode;
  className?: string;
  inputClassName?: string;
}

/**
 * The one search field of the app: a magnifier, the input, and an optional trailing
 * counter. The frame owns the size and the focus ring, the input stays transparent.
 */
export function SearchInput({
  variant = 'plain',
  aside,
  className,
  inputClassName,
  ...props
}: SearchInputProps) {
  return (
    <div className={cn('flex w-full items-center gap-2 text-muted', frameVariants[variant], className)}>
      <Search size={variant === 'boxed' ? 14 : 13} className="shrink-0" aria-hidden />
      <input
        type="search"
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent text-normal outline-none placeholder:text-faint',
          variant === 'plain' ? 'text-[13px]' : 'text-sm',
          inputClassName,
        )}
        {...props}
      />
      {aside ? <span className="shrink-0 text-[11px] tabular-nums text-faint">{aside}</span> : null}
    </div>
  );
}

/**
 * Search box with the magnifier overlapping the input (the icon sits inside the field, not
 * beside it). Used where the field must fill a narrow column without its own frame.
 */
export function InlineSearch({ className, inputClassName, ...props }: Omit<SearchInputProps, 'variant' | 'aside'>) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        className={cn(
          'h-7 w-full rounded-sm border-0 bg-app pl-7 pr-2 text-[13px] text-normal outline-none placeholder:text-faint',
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}
