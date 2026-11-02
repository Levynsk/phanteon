import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const inputVariants = cva(
  'w-full rounded-sm border-0 bg-input px-3 text-[15px] text-normal placeholder:text-faint outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-8 text-[13px]',
        md: 'h-10',
      },
      invalid: {
        true: 'focus-visible:ring-red',
        false: 'focus-visible:ring-brand',
      },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
);

export interface InputProps
  extends Omit<ComponentProps<'input'>, 'size'>,
    VariantProps<typeof inputVariants> {}

export function Input({ className, size, invalid, ...props }: InputProps) {
  return <input className={cn(inputVariants({ size, invalid: !!invalid }), className)} {...props} />;
}

export interface TextareaProps extends ComponentProps<'textarea'>, VariantProps<typeof inputVariants> {}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(inputVariants({ invalid: !!invalid }), 'min-h-20 resize-y px-3 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}
