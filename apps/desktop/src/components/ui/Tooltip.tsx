import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

interface SimpleTooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: ComponentProps<typeof TooltipPrimitive.Content>['side'];
  align?: ComponentProps<typeof TooltipPrimitive.Content>['align'];
  delayDuration?: number;
  className?: string;
}

export function Tooltip({ content, children, side = 'right', align = 'center', delayDuration = 120, className }: SimpleTooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            'z-50 max-w-64 rounded-sm bg-elevated px-2.5 py-2 text-[13px] font-medium leading-tight text-heading shadow-elevated',
            'data-[state=delayed-open]:animate-[content-in_120ms_ease-out]',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-elevated" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
