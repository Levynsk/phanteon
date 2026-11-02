import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-outline focus-visible:ring-offset-2 focus-visible:ring-offset-chat',
  {
    variants: {
      variant: {
        // opaque fills swap to an outline when disabled: dimming the brand fill turns it olive
        primary:
          'bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-hover disabled:pointer-events-none disabled:border disabled:border-brand-soft disabled:bg-transparent disabled:text-faint',
        success:
          'bg-green text-on-brand hover:bg-green-hover disabled:pointer-events-none disabled:border disabled:border-line-strong disabled:bg-transparent disabled:text-faint',
        danger:
          'bg-red text-on-brand hover:bg-red-hover disabled:pointer-events-none disabled:border disabled:border-red/30 disabled:bg-transparent disabled:text-faint',
        secondary:
          'border border-line-strong text-heading hover:border-line-strong hover:bg-tint disabled:pointer-events-none disabled:text-faint',
        ghost: 'bg-transparent text-normal hover:bg-hover hover:text-heading',
        link: 'bg-transparent text-link underline-offset-2 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px] rounded-sm',
        md: 'h-9 px-4 text-sm rounded-sm',
        lg: 'h-11 px-5 text-[15px] rounded-sm',
        icon: 'h-8 w-8 rounded-sm',
      },
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild && !loading ? Slot : 'button';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), className)}
      // never toggle `disabled` for loading: disabling the focused button moves
      // focus to <body>, which makes dialogs close as if the user clicked away
      aria-disabled={disabled || loading || undefined}
      disabled={disabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  );
}

export { buttonVariants };
export type { ButtonProps };
