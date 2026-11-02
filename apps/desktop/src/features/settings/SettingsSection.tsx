import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { LabelledField } from '../../components/ui/Field';

/**
 * Shared building blocks for both settings screens (user and server).
 *
 * The pages use one grid rhythm: a section block on the panel surface, an
 * inline header for the section's own title, and field rows whose label sits
 * above the control. Nothing here is sticky or fixed — everything scrolls with
 * the page, so the header of a tab is simply the first line of its content.
 */

interface SettingsShellProps {
  children: ReactNode;
  className?: string;
}

/** Root of a settings screen: a plain grid, never a dialog frame. */
export function SettingsShell({ children, className }: SettingsShellProps) {
  return <div className={cn('grid h-full min-h-0 grid-cols-[220px_1fr]', className)}>{children}</div>;
}

interface SettingsSidebarProps {
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

/** Navigation column: an optional identity header, the sections, and the close button at the bottom. */
export function SettingsSidebar({ header, children, onClose, closeLabel = 'Fechar' }: SettingsSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-divider bg-app-alt py-5 pl-3 pr-2">
      {header}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto [scrollbar-width:thin]" aria-label="Seções das configurações">
        {children}
      </nav>
      <div className="mt-3 border-t border-line pt-3">
        <button
          type="button"
          onClick={onClose}
          className="flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-[14px] font-medium text-muted transition-colors hover:bg-hover hover:text-normal"
        >
          <span aria-hidden className="size-4" />
          {closeLabel}
        </button>
      </div>
    </aside>
  );
}

interface SettingsNavItemProps {
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
  title?: string;
}

/** Row in a settings sidebar. A disabled row stays visible so the section stays discoverable. */
export function SettingsNavItem({ active, icon, children, onClick, trailing, disabled, title }: SettingsNavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[14px] leading-5 transition-colors',
        active ? 'bg-selected font-medium text-heading' : 'text-muted hover:bg-hover/60 hover:text-normal',
        disabled && 'opacity-40 hover:bg-transparent',
      )}
    >
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted">{trailing}</span> : null}
    </button>
  );
}

interface SettingsPageProps {
  title: string;
  description?: ReactNode;
  /** Actions aligned with the title (primary buttons for the whole page). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The scrollable content column. The title is part of the flow: scrolling a
 * long tab moves it away with the content, and a new tab starts at the top.
 */
export function SettingsPage({ title, description, actions, children, className }: SettingsPageProps) {
  return (
    <div className="flex min-h-0 flex-col overflow-y-auto bg-chat">
      <main className={cn('mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 pb-10 pt-7', className)}>
        <header className="flex items-start justify-between gap-4 border-b border-divider pb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-6 text-heading">{title}</h2>
            {description ? <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
        {children}
      </main>
    </div>
  );
}

interface SettingsSectionProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A card inside a page: a quiet surface with an optional inline header. */
export function SettingsSection({ title, description, actions, children, className }: SettingsSectionProps) {
  return (
    <section className={cn('rounded-md border border-divider bg-app-alt p-4', className)}>
      {title ? (
        <header className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-tight text-heading">{title}</h3>
            {description ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

interface SettingsFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** A counter or small control placed at the right of the label line. */
  aside?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Label above the control, hint below it: the single field layout used across settings.
 * The label line and the message line come from the shared `Field` primitives, so settings
 * fields and dialog fields share one implementation; only the aside slot is added here.
 */
export function SettingsField({ label, hint, error, aside, htmlFor = '', children, className }: SettingsFieldProps) {
  return (
    <LabelledField
      label={
        <>
          {label}
          {aside ? <span className="ml-3 float-right text-[11px] normal-case tracking-normal tabular-nums text-faint">{aside}</span> : null}
        </>
      }
      hint={hint}
      error={error}
      htmlFor={htmlFor}
      className={className}
    >
      {children}
    </LabelledField>
  );
}

interface SettingsToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  className?: string;
}

/** A label/description on the left and its control on the right, separated by a hairline. */
export function SettingsToggle({ label, hint, control, className }: SettingsToggleProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4 border-t border-line py-2.5 first:border-t-0 first:pt-0', className)}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-heading">{label}</div>
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

interface SettingsEmptyProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** Centered placeholder for an empty list or an unavailable section. */
export function SettingsEmpty({ icon, title, description, action }: SettingsEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      {icon ? <span className="text-faint">{icon}</span> : null}
      <p className="text-sm font-medium text-heading">{title}</p>
      {description ? <p className="max-w-[420px] text-[12px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
