import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-md border border-divider bg-input p-1.5 shadow-popover outline-none',
          'data-[state=open]:animate-[content-in_120ms_ease-out]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
