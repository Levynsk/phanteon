import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../../lib/cn';
import { Input, Textarea } from './Input';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-xs font-bold uppercase tracking-wide text-muted', className)}
      {...props}
    />
  );
}

/**
 * `stacked` is the dialog layout (bold label above the control, breathing room);
 * `quiet` is the sign-in layout (small label tight above an underline field).
 */
type FieldTone = 'stacked' | 'quiet';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor: string;
  hintId: string;
  children: ReactNode;
  className?: string;
  tone?: FieldTone;
}

function FieldShell({ label, hint, error, required, htmlFor, hintId, children, className, tone = 'stacked' }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col', tone === 'quiet' ? 'gap-1.5' : 'gap-2', className)}>
      <Label
        htmlFor={htmlFor}
        className={tone === 'quiet' ? 'text-[12px] font-medium normal-case tracking-normal' : undefined}
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-red" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className={cn(tone === 'quiet' ? 'text-[12px]' : 'text-xs', 'text-red')} id={hintId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={cn(tone === 'quiet' ? 'text-[12px]' : 'text-xs', 'text-muted')} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SharedFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
};

type TextFieldProps = SharedFieldProps & Omit<ComponentProps<typeof Input>, 'id'>;

/** Input wired to a label, hint and error message. */
export function TextField({ label, hint, error, required, ...inputProps }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={id} hintId={`${id}-hint`}>
      <Input
        id={id}
        className="bg-input-sunken"
        invalid={!!error}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
        {...inputProps}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = SharedFieldProps & Omit<ComponentProps<typeof Textarea>, 'id'>;

export function TextAreaField({ label, hint, error, required, ...textareaProps }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={id} hintId={`${id}-hint`}>
      <Textarea
        id={id}
        className="bg-input-sunken"
        invalid={!!error}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-hint` : undefined}
        {...textareaProps}
      />
    </FieldShell>
  );
}

/**
 * A field whose control lives outside the component: the caller renders the input (or a
 * select, a number box with its own width) and passes the same `id` it put on it.
 * `tone` picks the dialog typography or the quieter sign-in one.
 */
export function LabelledField({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className,
  tone,
}: Omit<FieldShellProps, 'hintId'>) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={htmlFor}
      hintId={`${htmlFor}-hint`}
      className={className}
      tone={tone}
    >
      {children}
    </FieldShell>
  );
}
