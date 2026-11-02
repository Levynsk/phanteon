import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

interface InlineSelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  'aria-label': string;
  className?: string;
}

/**
 * Native select styled as an input row: keeps the OS dropdown (long device names,
 * keyboard behaviour) without a custom popover to maintain.
 */
export function InlineSelect({ value, options, onChange, className, ...props }: InlineSelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-sm border border-divider bg-input-sunken pl-2.5 pr-8 text-sm text-normal outline-none transition-colors hover:border-line-strong focus:border-brand"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}
