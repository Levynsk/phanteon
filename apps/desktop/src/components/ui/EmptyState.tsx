import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-3 px-8 text-center', className)}>
      <div className="flex size-16 items-center justify-center rounded-full bg-input text-muted">
        <Icon size={30} aria-hidden />
      </div>
      <h2 className="text-xl font-bold text-heading">{title}</h2>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
