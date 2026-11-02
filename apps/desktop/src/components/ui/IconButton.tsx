import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon: LucideIcon;
  label: string;
  size?: number;
  active?: boolean;
  variant?: 'ghost' | 'solid';
}

export function IconButton({
  icon: Icon,
  label,
  size = 18,
  active,
  variant = 'ghost',
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-heading disabled:pointer-events-none disabled:opacity-50',
        active && 'text-heading',
        variant === 'solid' && 'bg-surface hover:bg-active',
        className,
      )}
      {...props}
    >
      <Icon size={size} aria-hidden />
    </button>
  );
}
