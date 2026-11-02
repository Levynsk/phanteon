import { useEffect, useState } from 'react';
import type { UserStatus } from '@phanteon/shared';
import { DEFAULT_ACCENT_COLORS } from '@phanteon/shared';
import { useAuthStore } from '../../app/stores/auth';
import { useUiStore } from '../../app/stores/ui';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Dialog, DialogContent } from '../ui/Dialog';
import { TextField } from '../ui/Field';
import { STATUS_LABEL, StatusDot, StatusBadge } from '../ui/Status';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';

const STATUS_OPTIONS: UserStatus[] = ['online', 'idle', 'dnd', 'offline'];

export function ProfileModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);
  const open = modal?.kind === 'profile';

  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<UserStatus>('online');
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ACCENT_COLORS[0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user || !open) return;
    setDisplayName(user.displayName);
    setStatus(user.status);
    setAccentColor(user.accentColor);
  }, [user, open]);

  if (!user) return null;

  const save = async () => {
    setLoading(true);
    try {
      await updateProfile({ displayName: displayName.trim(), status, accentColor });
      close();
      toast.success('Perfil atualizado');
    } catch (error) {
      toast.error('Falha ao salvar', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Meu perfil"
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void save()}
            submitLabel="Salvar"
            loading={loading}
            submitDisabled={!displayName.trim()}
            leading={
              <Button variant="ghost" className="text-red" onClick={logout}>
                Sair da conta
              </Button>
            }
          />
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <span className="relative inline-flex">
              <Avatar name={displayName || user.displayName} src={user.avatarUrl} color={accentColor} size="lg" />
              <StatusBadge status={status} ring="chat" size="md" />
            </span>
            <div>
              <div className="text-lg font-semibold text-heading">{displayName || user.displayName}</div>
              <div className="text-sm text-muted">@{user.username}</div>
            </div>
          </div>

          <TextField
            label="Nome de exibição"
            value={displayName}
            maxLength={40}
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Status</span>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={status === option}
                  onClick={() => setStatus(option)}
                  className={
                    status === option
                      ? 'flex items-center gap-2 rounded-md border border-brand bg-brand-soft px-3 py-2 text-sm text-heading'
                      : 'flex items-center gap-2 rounded-md border border-divider px-3 py-2 text-sm text-normal hover:border-muted'
                  }
                >
                  <StatusDot status={option} />
                  {STATUS_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Cor do avatar</span>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cor ${color}`}
                  aria-pressed={accentColor === color}
                  onClick={() => setAccentColor(color)}
                  className={cn(
                    'size-8 rounded-full ring-offset-2 ring-offset-chat transition-transform hover:scale-110',
                    accentColor === color && 'ring-2 ring-brand',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
