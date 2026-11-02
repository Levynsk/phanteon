import { useState } from 'react';
import { useUiStore } from '../../app/stores/ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';

export function ConfirmModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const [loading, setLoading] = useState(false);

  const confirm = async () => {
    if (modal?.kind !== 'confirm') return;
    setLoading(true);
    try {
      await modal.onConfirm();
      close();
    } catch (error) {
      toast.error('Não foi possível concluir a ação', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={modal?.kind === 'confirm'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title={modal?.kind === 'confirm' ? modal.title : ''}
        description={modal?.kind === 'confirm' ? modal.description : undefined}
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void confirm()}
            submitLabel={modal?.kind === 'confirm' ? modal.confirmLabel : 'Confirmar'}
            loading={loading}
            danger
          />
        }
      >
        <p className="text-sm text-muted">Esta ação não pode ser desfeita.</p>
      </DialogContent>
    </Dialog>
  );
}
