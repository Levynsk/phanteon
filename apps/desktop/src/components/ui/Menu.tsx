import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const Menu = DropdownMenuPrimitive.Root;
export const MenuTrigger = DropdownMenuPrimitive.Trigger;

export function MenuContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-[60] max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[188px] overflow-y-auto rounded-sm bg-elevated p-1.5 text-sm leading-tight text-normal shadow-popover',
          'data-[state=open]:animate-[content-in_100ms_ease-out]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

interface MenuItemProps extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
  variant?: 'default' | 'danger';
  icon?: ReactNode;
}

export function MenuItem({ className, variant = 'default', icon, children, ...props }: MenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-xs px-2 py-[6px] font-medium outline-none',
        'data-[highlighted]:bg-brand data-[highlighted]:text-on-brand',
        variant === 'danger' && 'text-red data-[highlighted]:bg-red',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.Item>
  );
}

export function MenuCheckboxItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-xs py-[6px] pl-2 pr-2 font-medium outline-none',
        'data-[highlighted]:bg-brand data-[highlighted]:text-on-brand data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export function MenuCheckboxItemContent({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <>
      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-line-strong">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check size={11} strokeWidth={3} aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {color ? <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  );
}

export function MenuRadioItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-xs px-2 py-[6px] font-medium outline-none',
        'data-[highlighted]:bg-brand data-[highlighted]:text-on-brand',
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('px-2 pb-1 pt-1 text-xs font-bold text-heading', className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-tint-strong', className)} {...props} />;
}
