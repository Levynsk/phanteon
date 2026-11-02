import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph, WindowButton } from '../../components/layout/WindowControls';
import { useWindowMaximized } from '../../lib/useWindowMaximized';
import { Starfield } from './Starfield';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
  /** Rendered on the artwork side; the defaults are plain invitations. */
  art?: ReactNode;
}

/**
 * Full-window authentication screen: the form sits directly on the app surface
 * (no card) next to a large soft artwork, under the same custom title bar the
 * signed-in app uses.
 */
export function AuthLayout({ title, subtitle, children, footer, art }: AuthLayoutProps) {
  const desktop = window.desktop;
  const isMac = desktop?.platform === 'darwin';
  const maximized = useWindowMaximized();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app">
      <header
        className="drag-region relative flex h-9 shrink-0 items-center"
        style={{ paddingLeft: isMac ? 78 : 16 }}
      >
        <span className="text-[13px] font-semibold tracking-tight text-muted">Phanteon</span>
        {desktop && !isMac ? (
          <div className="no-drag ml-auto flex h-full items-stretch">
            <WindowButton label="Minimizar" onClick={() => desktop.window.minimize()}>
              <MinimizeGlyph />
            </WindowButton>
            <WindowButton
              label={maximized ? 'Restaurar' : 'Maximizar'}
              onClick={() => desktop.window.toggleMaximize()}
            >
              {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
            </WindowButton>
            <WindowButton label="Fechar" danger onClick={() => desktop.window.close()}>
              <CloseGlyph />
            </WindowButton>
          </div>
        ) : null}
      </header>

      {/* a single centred column floating over the ASCII sky — no panels, no column split */}
      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <Starfield />
          {/* keeps the sky quiet behind the text so the form stays readable */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(46% 52% at 50% 50%, color-mix(in srgb, var(--color-app) 92%, transparent), color-mix(in srgb, var(--color-app) 55%, transparent) 55%, transparent 100%)',
            }}
          />
        </div>

        <section className="relative my-auto w-full px-6 py-10">
          <div className="mx-auto w-full max-w-[380px]">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-heading">{title}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>
            <div className="mt-8">{children}</div>
            <p className="mt-6 text-[13px] text-muted">{footer}</p>
            {art ? <div className="mt-10">{art}</div> : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export function AuthLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={cn('font-medium text-link hover:underline')}>
      {children}
    </Link>
  );
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[13px] text-red">
      {children}
    </p>
  );
}
