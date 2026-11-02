import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * The native checkbox, used wherever a `<label>` wraps the control with its own caption
 * (inline rows such as "criar um canal dentro dela"). It keeps the OS semantics and just
 * applies the shared sizing and accent colour.
 */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return <input type="checkbox" className={cn('size-3.5 shrink-0 accent-brand', className)} {...props} />;
}

interface CheckboxRowProps extends Omit<ComponentProps<'input'>, 'type'> {
  children: ReactNode;
}

/** A checkbox with its caption inside the click target, on a hoverable row. */
export function CheckboxRow({ className, children, ...props }: CheckboxRowProps) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 text-sm text-normal', className)}>
      <Checkbox {...props} />
      {children}
    </label>
  );
}
