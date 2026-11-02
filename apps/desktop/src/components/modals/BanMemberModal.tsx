import { useEffect, useState } from 'react';
import { useUiStore } from '../../app/stores/ui';
import { useChatStore } from '../../app/stores/chat';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Dialog, DialogContent } from '../ui/Dialog';
import { TextAreaField } from '../ui/Field';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';

const HOUR = 60 * 60 * 1000;

/** Preset durations, mirroring Discord's ban dialog. `null` = permanent. */
const DURATIONS: { label: string; value: number | null }[] = [
  { label: 'Permanente', value: null },
  { label: '1 hora', value: HOUR },
  { label: '6 horas', value: 6 * HOUR },
  { label: '1 dia', value: 24 * HOUR },
  { label: '3 dias', value: 72 * HOUR },
  { label: '7 dias', value: 7 * 24 * HOUR },
];

export function BanMemberModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const removeMemberFromGuild = useChatStore((state) => state.removeMemberFromGuild);
  const open = modal?.kind === 'ban-member';
  const [duration, setDuration] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setDuration(null);
      setReason('');
    }
  }, [open, modal]);

  const submit = async () => {
    if (modal?.kind !== 'ban-member') return;
    setLoading(true);
    try {
      const { ban } = await api.guilds.ban(modal.guildId, modal.userId, {
        reason: reason.trim() || null,
        durationMs: duration,
      });
      removeMemberFromGuild(modal.guildId, modal.userId);
      const until = ban.expiresAt ? new Date(ban.expiresAt).toLocaleString('pt-BR') : 'permanentemente';
      toast.success(`${ban.user.displayName} foi banido(a) ${ban.expiresAt ? `até ${until}` : until}`);
      close();
    } catch (error) {
      toast.error('Falha ao banir membro', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title={modal?.kind === 'ban-member' ? `Banir ${modal.displayName}` : 'Banir'}
        description="A pessoa sai do servidor e não consegue voltar por convite enquanto o banimento estiver ativo."
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void submit()}
            submitLabel="Banir"
            loading={loading}
            danger
          />
        }
      >
        <fieldset className="mb-4">
          <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Duração</legend>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((option) => {
              const active = duration === option.value;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setDuration(option.value)}
                  aria-pressed={active}
                  className={cn(
                    'h-9 rounded-sm border px-2 text-[13px] font-medium transition-colors',
                    active
                      ? 'border-brand bg-brand/15 text-brand'
                      : 'border-divider bg-app text-muted hover:border-muted hover:text-normal',
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <TextAreaField
          label="Motivo"
          placeholder="Explique o motivo do banimento (opcional)"
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}
