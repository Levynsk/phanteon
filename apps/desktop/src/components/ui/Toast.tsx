import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import { cn } from '../../lib/cn';

type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** ms before auto-dismiss; toasts with an action stay longer. */
  duration?: number;
}

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  action?: ToastAction;
  duration?: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => number;
  dismiss: (id: number) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (toast) => {
    const id = Date.now() + Math.random();
    set((state) => ({ items: [...state.items.slice(-3), { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

function push(title: string, variant: ToastVariant, description?: string, options?: ToastOptions) {
  return useToastStore.getState().push({ title, description, variant, ...options });
}

/** Imperative toast helpers usable outside React components. */
export const toast = Object.assign(
  (title: string, description?: string, options?: ToastOptions) => push(title, 'info', description, options),
  {
    success: (title: string, description?: string, options?: ToastOptions) => push(title, 'success', description, options),
    error: (title: string, description?: string, options?: ToastOptions) => push(title, 'error', description, options),
    info: (title: string, description?: string, options?: ToastOptions) => push(title, 'info', description, options),
    dismiss: (id: number) => useToastStore.getState().dismiss(id),
  },
);

const VARIANT_ICON: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: TriangleAlert,
  info: Info,
};

const VARIANT_COLOR: Record<ToastVariant, string> = {
  success: 'text-green',
  error: 'text-red',
  info: 'text-link',
};

/** Mount once near the root; renders the toast viewport and items. */
export function Toaster() {
  const items = useToastStore((state) => state.items);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((item) => (
        <ToastEntry key={item.id} item={item} />
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 top-12 z-[100] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}

function ToastEntry({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [open, setOpen] = useState(true);
  const Icon = VARIANT_ICON[item.variant];

  return (
    <ToastPrimitive.Root
      open={open}
      duration={item.duration ?? (item.action ? 8000 : 4500)}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) window.setTimeout(() => dismiss(item.id), 200);
      }}
      className="flex w-full items-start gap-3 rounded-md border border-divider bg-input p-3 text-sm shadow-elevated data-[state=closed]:opacity-0 data-[state=open]:animate-[toast-in_160ms_ease-out]"
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', VARIANT_COLOR[item.variant])} aria-hidden />
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="font-semibold text-heading">{item.title}</ToastPrimitive.Title>
        {item.description ? (
          <ToastPrimitive.Description className="mt-0.5 break-words text-xs text-muted">
            {item.description}
          </ToastPrimitive.Description>
        ) : null}
        {item.action ? (
          <button
            type="button"
            className="mt-2 rounded-sm bg-tint-strong px-2.5 py-1 text-xs font-semibold text-heading transition-colors hover:bg-line-strong"
            onClick={() => {
              item.action?.onClick();
              setOpen(false);
              window.setTimeout(() => dismiss(item.id), 200);
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <ToastPrimitive.Close aria-label="Fechar aviso" className="text-muted hover:text-heading">
        <X className="size-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
