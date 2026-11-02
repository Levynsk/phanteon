import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

/**
 * Shared track/thumb so every switch (Radix or native checkbox) looks the same:
 * tracked-off is a neutral pill, tracked-on is the brand colour, and the thumb
 * is a light disc with a contrast ring so it still reads on a light track.
 */
export const switchTrackClass = cn(
  'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors',
  'bg-line-strong hover:bg-line',
  'data-[state=checked]:bg-brand data-[state=checked]:hover:bg-brand-hover',
);

export const switchThumbClass = cn(
  'pointer-events-none block size-5 rounded-full bg-switch-thumb shadow-[0_1px_3px_rgb(0_0_0/0.35)] ring-1 ring-switch-thumb-ring transition-transform',
  'translate-x-0.5 data-[state=checked]:translate-x-[18px]',
);

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn(switchTrackClass, className)} {...props}>
      <SwitchPrimitive.Thumb className={switchThumbClass} />
    </SwitchPrimitive.Root>
  );
}

interface NativeSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}

/** A visually identical switch for plain `<input type="checkbox">` state. */
export function NativeSwitch({ checked, onChange, disabled, label, className }: NativeSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand hover:bg-brand-hover' : 'bg-line-strong hover:bg-line',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0.5 block size-5 rounded-full bg-switch-thumb shadow-[0_1px_3px_rgb(0_0_0/0.35)] ring-1 ring-switch-thumb-ring transition-transform',
          checked ? 'left-[18px]' : 'left-0.5',
        )}
      />
    </button>
  );
}
