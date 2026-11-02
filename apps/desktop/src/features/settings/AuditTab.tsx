import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import type { AuditLogEntry } from '@phanteon/shared';
import { api } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { toast } from '../../components/ui/Toast';
import { InlineSelect } from './InlineSelect';
import { SettingsEmpty } from './SettingsSection';

interface AuditTabProps {
  guildId: string;
  canView: boolean;
}

const PAGE_SIZE = 25;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
}

export function AuditTab({ guildId, canView }: AuditTabProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [action, setAction] = useState('');
  const [targetId, setTargetId] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    api.guilds
      .auditActions(guildId)
      .then(({ actions: labels }) => setActions(labels))
      .catch(() => undefined);
  }, [canView, guildId]);

  const load = useCallback(
    async (options: { append?: boolean } = {}) => {
      if (!canView) return;
      setLoading(true);
      try {
        const page = await api.guilds.auditLogs(guildId, {
          action: action || undefined,
          targetId: targetId.trim() || undefined,
          before: options.append ? (cursor ?? undefined) : undefined,
          limit: PAGE_SIZE,
        });
        setEntries((current) => (options.append ? [...current, ...page.entries] : page.entries));
        setCursor(page.nextCursor);
        setTotal(page.total);
      } catch (error) {
        toast.error('Não foi possível carregar os logs', error instanceof Error ? error.message : undefined);
      } finally {
        setLoading(false);
      }
    },
    [canView, guildId, action, targetId],
  );

  // reload from the first page whenever the filters change
  useEffect(() => {
    void load();
  }, [guildId, action, canView]);

  if (!canView) {
    return (
      <SettingsEmpty
        icon={<ScrollText size={20} aria-hidden />}
        title="Sem permissão"
        description="Só quem tem a permissão “Ver logs de auditoria” pode consultar este histórico."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InlineSelect
          aria-label="Filtrar por ação"
          value={action}
          onChange={setAction}
          className="w-[200px]"
          options={[{ value: '', label: 'Todas as ações' }, ...Object.entries(actions).map(([value, label]) => ({ value, label }))]}
        />
        <SearchInput
          variant="boxed"
          className="min-w-[200px] flex-1"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void load();
          }}
          placeholder="Filtrar por ID do usuário (Enter)"
          aria-label="Filtrar por ID do usuário"
        />
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          Atualizar
        </Button>
        <span className="text-[11px] tabular-nums text-faint">
          {total} registro{total === 1 ? '' : 's'}
        </span>
      </div>

      {entries.length === 0 ? (
        <SettingsEmpty
          icon={<ScrollText size={20} aria-hidden />}
          title={loading ? 'Carregando…' : 'Nenhum registro'}
          description="Ações de moderação, canais, cargos e convites aparecem aqui automaticamente."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-md border border-divider bg-app-alt">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-3 py-2.5">
              <Avatar name={entry.actor.displayName} src={entry.actor.avatarUrl} color="#71717a" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-normal">
                  <span className="font-semibold text-heading">{entry.actor.displayName}</span>{' '}
                  {actions[entry.action] ?? entry.action}
                  {entry.targetName ? (
                    <>
                      : <span className="font-medium text-heading">{entry.targetName}</span>
                    </>
                  ) : null}
                </p>
                {entry.reason ? <p className="truncate text-[11px] text-muted">Motivo: {entry.reason}</p> : null}
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatWhen(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <Button variant="secondary" block onClick={() => void load({ append: true })} loading={loading}>
          Carregar mais
        </Button>
      ) : null}
    </div>
  );
}
