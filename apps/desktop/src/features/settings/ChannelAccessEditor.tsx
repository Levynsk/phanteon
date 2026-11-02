import type { Channel, GuildRoleEntity } from '@phanteon/shared';
import { Lock, Globe, ShieldCheck, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Checkbox } from '../../components/ui/Checkbox';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

export interface AccessDraft {
  visibility: 'public' | 'private';
  roleIds: string[];
}

interface ChannelAccessEditorProps {
  /** Category or channel being edited; `null` while it is still being created. */
  channel: Channel | null;
  guildId: string;
  roles: GuildRoleEntity[];
  value: AccessDraft;
  onChange: (value: AccessDraft) => void;
  /** Whether `value` reflects what the server has stored (false until the first load succeeds). */
  onLoaded?: (loaded: boolean) => void;
  onSynced?: (channels: Channel[]) => void;
  readOnly?: boolean;
}

/**
 * Public/private switch plus the roles allowed in, mirroring Discord's channel
 * permissions: private means @everyone loses View Channel and the listed roles
 * get it back.
 */
export function ChannelAccessEditor({
  channel,
  guildId,
  roles,
  value,
  onChange,
  onLoaded,
  onSynced,
  readOnly,
}: ChannelAccessEditorProps) {
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // a null target (channel not created yet) keeps the draft the parent owns
    if (!channel) return;
    let cancelled = false;
    setLoading(true);
    onLoaded?.(false);
    api.channels
      .overrides(channel.id)
      .then(({ overrides }) => {
        if (cancelled) return;
        const granted = overrides
          .filter((override) => override.roleId !== '@everyone' && (override.allow & 1) === 1)
          .map((override) => override.roleId);
        onChange({ visibility: channel.private ? 'private' : 'public', roleIds: granted });
        onLoaded?.(true);
      })
      .catch(() => {
        // without the stored access the draft stays "not loaded" and saves leave it alone
        if (!cancelled) onLoaded?.(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // only re-read when the target changes; `onChange` identity is not stable
  }, [channel?.id]);

  const toggleRole = (roleId: string) => {
    const has = value.roleIds.includes(roleId);
    onChange({
      ...value,
      roleIds: has ? value.roleIds.filter((id) => id !== roleId) : [...value.roleIds, roleId],
    });
  };

  const sync = async () => {
    if (!channel) return;
    setSyncing(true);
    try {
      const result =
        channel.type === 'category'
          ? await api.guilds.syncCategoryPermissions(guildId, channel.id)
          : await api.channels.syncPermissions(channel.id);
      onSynced?.(result.channels);
    } finally {
      setSyncing(false);
    }
  };

  const selectable = roles.filter((role) => !role.isEveryone);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          'flex items-center justify-between gap-4 rounded-md border px-3 py-2.5 transition-colors',
          value.visibility === 'private' ? 'border-warn/40 bg-warn/5' : 'border-divider',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          {value.visibility === 'private' ? (
            <Lock size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          ) : (
            <Globe size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-heading">Canal privado</div>
            <p className="text-[12px] text-muted">
              Só cargos com acesso e administradores podem ver {channel?.type === 'category' ? 'esta categoria e seus canais' : 'este canal'}.
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.visibility === 'private'}
          aria-label="Canal privado"
          disabled={readOnly}
          onClick={() => onChange({ ...value, visibility: value.visibility === 'private' ? 'public' : 'private' })}
          className={cn(
            'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
            value.visibility === 'private' ? 'bg-warn' : 'bg-line-strong',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-full bg-switch-thumb shadow ring-1 ring-switch-thumb-ring transition-transform',
              value.visibility === 'private' ? 'translate-x-[18px]' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      <div className={cn('flex flex-col gap-1', value.visibility !== 'private' && 'opacity-50')}>
        <span className="text-xs font-bold uppercase tracking-wide text-muted">Cargos com acesso</span>
        {loading && channel ? (
          <p className="text-[12px] text-muted">Carregando permissões…</p>
        ) : selectable.length === 0 ? (
          <p className="text-[12px] text-muted">Crie um cargo para liberar o acesso a este canal.</p>
        ) : (
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-md border border-divider p-1 [scrollbar-width:thin]">
            {selectable.map((role) => {
              const checked = value.roleIds.includes(role.id);
              return (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-hover"
                >
                  <Checkbox
                    checked={checked}
                    disabled={readOnly || value.visibility !== 'private'}
                    onChange={() => toggleRole(role.id)}
                  />
                  <ShieldCheck size={13} style={{ color: role.color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-normal" style={{ color: role.color }}>
                    {role.name}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-muted">
          Mesmo privado, quem tem a permissão &quot;Administrador&quot; ou &quot;Gerenciar canais&quot; continua vendo o canal.
        </p>
      </div>

      <button
        type="button"
        disabled={readOnly || !channel || syncing}
        onClick={() => void sync()}
        className="flex w-fit items-center gap-1.5 rounded-sm border border-divider px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-muted hover:text-heading disabled:opacity-40"
      >
        <RefreshCw size={12} className={cn(syncing && 'animate-spin')} aria-hidden />
        {syncing ? 'Sincronizando…' : 'Sincronizar permissões com os canais'}
      </button>
    </div>
  );
}
