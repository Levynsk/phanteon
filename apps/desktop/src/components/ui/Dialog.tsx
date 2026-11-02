import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps
  extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title' | 'children'> {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'settings';
  hideClose?: boolean;
  /** Drops the body padding so the content can bleed to the dialog edges. */
  bleed?: boolean;
  /** Hides the footer spacer (use when the content manages its own bottom padding). */
  hideFooter?: boolean;
  /** Keep a fixed body height so the dialog never grows with its content. */
  fixedBody?: boolean;
  children: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<DialogContentProps['size']>, string> = {
  sm: 'max-w-[460px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[720px]',
  xl: 'max-w-[920px]',
  settings: 'h-[min(88vh,760px)] max-w-[1000px]',
};

export function DialogContent({
  title,
  description,
  footer,
  size = 'sm',
  hideClose,
  bleed,
  hideFooter,
  fixedBody,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-[overlay-in_150ms_ease-out_both]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-divider bg-chat shadow-popover',
          'data-[state=open]:animate-[content-in_160ms_ease-out_both]',
          SIZE_CLASS[size],
          className,
        )}
        {...props}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-divider px-6 pb-4 pt-5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-xl font-bold leading-tight text-heading">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-2 text-sm leading-relaxed text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Janela'}</DialogPrimitive.Description>
            )}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-hover hover:text-heading"
              aria-label="Fechar"
            >
              <X size={18} aria-hidden />
            </DialogPrimitive.Close>
          )}
        </header>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            bleed ? undefined : 'px-6 py-4',
            fixedBody && (size === 'settings' ? 'h-full' : 'h-[min(60vh,440px)]'),
          )}
        >
          {children}
        </div>

        {footer !== undefined && footer !== null ? (
          <footer className="flex items-center justify-end gap-2 border-t border-divider px-6 py-4">{footer}</footer>
        ) : footer === null ? null : hideFooter ? null : (
          <div className="h-4" />
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
