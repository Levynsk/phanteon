import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1.5 text-[14px] text-normal shadow-popover',
          'data-[state=open]:animate-[content-in_120ms_ease-out]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

const itemClass =
  'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[14px] text-normal outline-none transition-colors data-[highlighted]:bg-brand data-[highlighted]:text-on-brand data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { variant?: 'default' | 'danger' }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(itemClass, variant === 'danger' && 'text-red data-[highlighted]:bg-red', className)}
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(itemClass, className)} {...props}>
      {children}
      <DropdownMenuPrimitive.ItemIndicator className="ml-auto">
        <Check size={14} aria-hidden />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-tint-strong', className)} {...props} />;
}

/** Icon + label row helper to keep menu items visually consistent. */
export function MenuItemContent({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-4 items-center justify-center opacity-80">{icon}</span>
      {children}
    </span>
  );
}
