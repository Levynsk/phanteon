import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export const Tabs = TabsPrimitive.Root;

/**
 * A tab strip with a divider under it, so tabs never blend into the content
 * below. Sliding the strip sideways also scrolls with the wheel.
 */
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex h-11 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-divider px-4',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      onWheel={(event) => {
        if (event.deltaY === 0 || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
        event.currentTarget.scrollLeft += event.deltaY;
      }}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-semibold text-muted transition-colors',
        'hover:text-normal data-[state=active]:text-heading',
        'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-brand',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain focus:outline-none', className)}
      {...props}
    />
  );
}
