import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn';
import { LabelledField } from './Field';
import { Input } from './Input';

/**
 * Sign-in field: the same label / input / hint / error shell as every dialog field,
 * in its `quiet` tone (small label, hairline underline instead of a boxed control).
 */
export function AuthField({
  label,
  hint,
  error,
  className,
  ...props
}: { label: ReactNode; hint?: ReactNode; error?: ReactNode } & Omit<ComponentProps<'input'>, 'size'>) {
  const id = useId();
  return (
    <LabelledField label={label} hint={hint} error={error} htmlFor={id} tone="quiet">
      <Input
        id={id}
        invalid={!!error}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
        className={cn(
          'h-11 rounded-none border-0 border-b border-divider bg-transparent px-0 text-[15px] text-normal shadow-none',
          // override both the invalid and valid focus rings from Input
          // focus-visible only fires for keyboard users, so the accent rides on :focus
          'placeholder:text-faint focus:rounded-none focus:!ring-0 focus:border-brand focus:shadow-[inset_0_-1px_0_var(--color-brand)]',
          error && 'border-red focus:border-red focus:shadow-[inset_0_-1px_0_var(--color-red)]',
          className,
        )}
        {...props}
      />
    </LabelledField>
  );
}
