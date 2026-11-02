import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { useEffect, type ComponentProps } from 'react';
import { cn } from '../../lib/cn';

interface ScrollAreaProps extends ComponentProps<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  viewportRef?: ComponentProps<typeof ScrollAreaPrimitive.Viewport>['ref'];
  /** Callback with the scrolling element (the viewport's inner div), e.g. to scroll it. */
  viewportInnerRef?: (node: HTMLDivElement | null) => void;
  onViewportScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}

export function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  viewportInnerRef,
  onViewportScroll,
  children,
  ...props
}: ScrollAreaProps) {
  // Radix owns the viewport ref; the scrollable box is the viewport's only child
  useEffect(() => {
    if (!viewportInnerRef || !viewportRef || typeof viewportRef !== 'object') return;
    viewportInnerRef((viewportRef.current?.firstElementChild as HTMLDivElement | null) ?? null);
  });

  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScroll={onViewportScroll}
        // Radix puts `display: table; min-width: 100%` on the viewport's inner box. A table
        // grows to fit its widest child, so long text would widen the area instead of
        // wrapping. Block layout keeps the inner box bound to the viewport width, which is
        // what makes `break-words` / `min-w-0` inside chat and lists actually wrap.
        className={cn('size-full rounded-[inherit] [&>div]:!block [&>div]:!min-w-0', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-colors data-[state=hidden]:opacity-0"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-line-strong" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
