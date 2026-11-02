import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { toast } from '../../components/ui/Toast';

export const IMAGE_ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export function validateImage(file: File): string | null {
  if (!IMAGE_ACCEPT.includes(file.type)) return 'Use PNG, JPEG, WebP ou GIF.';
  if (file.size > IMAGE_MAX_BYTES) return 'O limite é 4 MB.';
  return null;
}

interface ImagePickerProps {
  /** Accessible name for the control, e.g. "Alterar ícone". */
  label: string;
  disabled?: boolean;
  onFile: (file: File) => Promise<void>;
  children: ReactNode;
  className?: string;
  /** Extra classes for the upload overlay (used as the click target). */
  overlayClassName?: string;
  /** Custom overlay markup; defaults to a hover camera badge. */
  overlay?: ReactNode;
  /** Dims the content while the upload is in flight. */
  busyClassName?: string;
}

/**
 * Wraps a preview and turns it into a file picker (Discord's click-to-change
 * pattern). Shows hover feedback, a busy spinner and a focusable input.
 */
export function ImagePicker({
  label,
  disabled,
  onFile,
  children,
  className,
  overlayClassName,
  overlay,
  busyClassName,
}: ImagePickerProps) {
  const [busy, setBusy] = useState(false);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = validateImage(file);
    if (problem) {
      toast.error('Formato inválido', problem);
      return;
    }
    setBusy(true);
    try {
      await onFile(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('group relative', className)}>
      <div className={cn('size-full transition-opacity', busy && (busyClassName ?? 'opacity-50'))}>{children}</div>
      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center bg-elevated/40 text-heading [border-radius:inherit]">
          <Loader2 size={18} className="animate-spin" aria-hidden />
        </span>
      ) : null}
      <label
        className={cn(
              'absolute cursor-pointer',
          overlay === undefined &&
            'inset-0 flex items-center justify-center bg-elevated/55 text-heading opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
          overlayClassName,
          disabled && 'pointer-events-none opacity-0',
        )}
        title={label}
      >
        {overlay ?? <Camera size={18} aria-hidden />}
        {overlay === undefined ? <span className="sr-only">{label}</span> : null}
        <input
          type="file"
          accept={IMAGE_ACCEPT.join(',')}
          className="sr-only"
          aria-label={label}
          disabled={disabled || busy}
          onChange={(event) => void handleChange(event)}
        />
      </label>
    </div>
  );
}
