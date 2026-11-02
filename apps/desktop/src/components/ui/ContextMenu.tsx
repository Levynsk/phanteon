import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { Check, ChevronRight } from 'lucide-react';
import { Children, isValidElement, type ComponentProps, type ElementType, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

/**
 * Every row lays its content out on the same three-track grid: a fixed 16px icon column, the
 * label, and a trailing column for the submenu chevron. The icon column is always reserved —
 * even in rows without an icon — so every label starts at the same x and the gap between icon
 * and text is identical in the whole menu.
 */
const rowGrid = 'grid grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-x-2';

const rowBase = cn(
  rowGrid,
  'w-full cursor-pointer select-none rounded-sm px-2 py-1.5 text-left text-[14px] leading-5 text-normal outline-none transition-colors',
);

const rowInteractive =
  'data-[highlighted]:bg-brand data-[highlighted]:text-on-brand data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

const surfaceBase = 'rounded-md border border-line bg-elevated p-1.5 text-[14px] text-normal shadow-popover';

/**
 * A child `<svg>` is inline, and its baseline would add extra height under the glyph; a block
 * icon is exactly the 16px column, so the row height depends only on its padding.
 */
const iconClass = '[&>svg]:block [&>svg]:shrink-0';

function MenuIcon({ children }: { children: ReactNode }) {
  return <span className={cn('flex size-4 items-center justify-center text-muted', iconClass)}>{children}</span>;
}

function MenuLabel({ children }: { children: ReactNode }) {
  return <span className={cn('min-w-0 truncate', iconClass)}>{children}</span>;
}

function MenuChevron() {
  return <ChevronRight className="size-4 justify-self-end text-faint" aria-hidden />;
}

/**
 * Callers may pass the leading icon through the `icon` prop or as the first child of the row.
 * A child icon is lifted out of the children so both styles end up in the same icon column.
 */
function pullLeadingIcon(children: ReactNode): { icon: ReactNode; rest: ReactNode } {
  const items = Children.toArray(children);
  const first = items[0];
  if (!isValidElement<unknown>(first)) return { icon: null, rest: children };
  const type = first.type as ElementType;
  if (type !== 'svg' && (type as { displayName?: string }).displayName !== 'LucideIcon') {
    return { icon: null, rest: children };
  }
  return { icon: first, rest: items.slice(1) };
}

interface RowContentProps {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}

/** Icon (or an empty icon cell), label, trailing slot — the repeated body of every row. */
function RowContent({ icon, children, trailing }: RowContentProps) {
  const leading = pullLeadingIcon(children);
  const leadingIcon = leading.icon ?? icon;
  return (
    <>
      {leadingIcon ? <MenuIcon>{leadingIcon}</MenuIcon> : <span aria-hidden />}
      <MenuLabel>{leading.rest}</MenuLabel>
      {trailing ?? <span aria-hidden />}
    </>
  );
}

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'fixed z-50 min-w-[220px]',
          surfaceBase,
          'data-[state=open]:animate-[content-in_120ms_ease-out]',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

/**
 * Just the menu surface, for menus that position themselves (e.g. over a call
 * card, where a slider must not close on drag). Use `ContextMenuItem` inside it.
 */
export function ContextMenuSurface({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      role="menu"
      className={cn(surfaceBase, 'animate-[content-in_120ms_ease-out]', className)}
      {...props}
    />
  );
}

interface ContextMenuItemProps extends ComponentProps<typeof ContextMenuPrimitive.Item> {
  variant?: 'default' | 'danger';
  icon?: ReactNode;
  /** Hint rendered in the trailing column, e.g. a shortcut. */
  shortcut?: string;
  /** Renders the submenu chevron column (use on the last row of a submenu drill-in). */
  chevron?: boolean;
}

export function ContextMenuItem({
  className,
  variant = 'default',
  icon,
  shortcut,
  chevron,
  children,
  ...props
}: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        rowBase,
        rowInteractive,
        variant === 'danger' && 'text-red data-[highlighted]:bg-red data-[highlighted]:text-white',
        className,
      )}
      {...props}
    >
      <RowContent
        icon={icon}
        trailing={
          shortcut ? (
            <span className="justify-self-end text-[11px] tracking-wide text-faint">{shortcut}</span>
          ) : chevron ? (
            <MenuChevron />
          ) : undefined
        }
      >
        {children}
      </RowContent>
    </ContextMenuPrimitive.Item>
  );
}

interface ContextMenuSubTriggerProps extends ComponentProps<typeof ContextMenuPrimitive.SubTrigger> {
  icon?: ReactNode;
}

export function ContextMenuSubTrigger({ className, icon, children, ...props }: ContextMenuSubTriggerProps) {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(rowBase, rowInteractive, 'data-[state=open]:bg-hover', className)}
      {...props}
    >
      <RowContent icon={icon} trailing={<MenuChevron />}>
        {children}
      </RowContent>
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        className={cn('fixed z-50 min-w-[200px]', surfaceBase, 'animate-[content-in_120ms_ease-out]', className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

interface ContextMenuCheckboxItemProps extends ComponentProps<typeof ContextMenuPrimitive.CheckboxItem> {
  icon?: ReactNode;
}

export function ContextMenuCheckboxItem({ className, icon, children, ...props }: ContextMenuCheckboxItemProps) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      className={cn(rowBase, rowInteractive, 'pl-8 [&>span:first-child]:absolute [&>span:first-child]:left-2', className)}
      {...props}
    >
      {icon ? <MenuIcon>{icon}</MenuIcon> : <span aria-hidden />}
      <MenuLabel>{children}</MenuLabel>
      <span aria-hidden />
    </ContextMenuPrimitive.CheckboxItem>
  );
}

/** Radio item for toggles inside a menu; the check mark sits in the trailing column. */
export function ContextMenuRadioItem({ className, children, ...props }: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(rowBase, rowInteractive, 'data-[state=checked]:text-brand', className)}
      {...props}
    >
      <span aria-hidden />
      <MenuLabel>{children}</MenuLabel>
      <ContextMenuPrimitive.ItemIndicator className="col-start-3 justify-self-end">
        <Check className="size-4" aria-hidden />
      </ContextMenuPrimitive.ItemIndicator>
    </ContextMenuPrimitive.RadioItem>
  );
}

/** Same-looking row inside a `ContextMenuSurface` (a plain div, not a Radix menu). */
export function ContextMenuRow({
  className,
  variant = 'default',
  icon,
  onSelect,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'onClick'> & {
  variant?: 'default' | 'danger';
  icon?: ReactNode;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        rowBase,
        'hover:bg-hover',
        variant === 'danger' && 'text-red hover:bg-red hover:text-white',
        className,
      )}
      onClick={onSelect}
      {...props}
    >
      <RowContent icon={icon}>{children}</RowContent>
    </button>
  );
}

interface ContextMenuLabelProps extends ComponentProps<typeof ContextMenuPrimitive.Label> {
  icon?: ReactNode;
}

export function ContextMenuLabel({ className, icon, children, ...props }: ContextMenuLabelProps) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(rowGrid, 'px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-faint', className)}
      {...props}
    >
      {icon ? <MenuIcon>{icon}</MenuIcon> : <span aria-hidden />}
      <MenuLabel>{children}</MenuLabel>
      <span aria-hidden />
    </ContextMenuPrimitive.Label>
  );
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn('my-1 h-px bg-tint-strong', className)} {...props} />;
}
