import type { ReactNode } from 'react';
import { Button } from '../ui/Button';

interface DialogActionsProps {
  onCancel: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  submitDisabled?: boolean;
  danger?: boolean;
  leading?: ReactNode;
}

export function DialogActions({
  onCancel,
  onSubmit,
  submitLabel = 'Salvar',
  cancelLabel = 'Cancelar',
  loading,
  submitDisabled,
  danger,
  leading,
}: DialogActionsProps) {
  return (
    <>
      {leading}
      <div className="flex-1" />
      <Button variant="ghost" onClick={onCancel}>
        {cancelLabel}
      </Button>
      {onSubmit ? (
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onSubmit}
          loading={loading}
          aria-disabled={submitDisabled || undefined}
          className={submitDisabled && !loading ? 'pointer-events-none' : undefined}
        >
          {submitLabel}
        </Button>
      ) : null}
    </>
  );
}
