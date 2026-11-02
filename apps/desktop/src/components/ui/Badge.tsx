import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex min-w-4 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-4',
  {
    variants: {
      variant: {
        brand: 'bg-brand text-on-brand',
        danger: 'bg-red text-on-brand',
        neutral: 'border border-line-strong text-heading',
        success: 'bg-brand-soft text-brand',
      },
    },
    defaultVariants: { variant: 'brand' },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Horizontal rule used across panels and menus. */
export function Separator({ className, ...props }: ComponentProps<'div'>) {
  return <div role="separator" className={cn('h-px w-full bg-divider', className)} {...props} />;
}
