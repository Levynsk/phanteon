import { useCallback, useEffect, useState } from 'react';
import { Hammer, Undo2 } from 'lucide-react';
import type { GuildBan } from '@phanteon/shared';
import { api } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { SearchInput } from '../../components/ui/SearchInput';
import { toast } from '../../components/ui/Toast';
import { SettingsEmpty } from './SettingsSection';

interface BansTabProps {
  guildId: string;
  canBan: boolean;
}

function formatExpiry(ban: GuildBan): string {
  if (!ban.expiresAt) return 'Permanente';
  const date = new Date(ban.expiresAt);
  if (date.getTime() <= Date.now()) return 'Expirado';
  return `Expira em ${date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
}

export function BansTab({ guildId, canBan }: BansTabProps) {
  const [bans, setBans] = useState<GuildBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { bans: list } = await api.guilds.listBans(guildId);
      setBans(list);
    } catch (error) {
      toast.error('Não foi possível carregar os banimentos', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    if (canBan) void load();
  }, [canBan, load]);

  const revoke = async (ban: GuildBan) => {
    setRevoking(ban.user.id);
    try {
      await api.guilds.unban(guildId, ban.user.id);
      setBans((current) => current.filter((entry) => entry.user.id !== ban.user.id));
      toast.success(`${ban.user.displayName} não está mais banido(a)`);
    } catch (error) {
      toast.error('Falha ao revogar banimento', error instanceof Error ? error.message : undefined);
    } finally {
      setRevoking(null);
    }
  };

  if (!canBan) {
    return (
      <SettingsEmpty
        icon={<Hammer size={20} aria-hidden />}
        title="Sem permissão"
        description="Só quem tem a permissão de banir membros pode ver os banimentos deste servidor."
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = bans.filter(
    (ban) =>
      !needle ||
      ban.user.displayName.toLowerCase().includes(needle) ||
      ban.user.username.toLowerCase().includes(needle) ||
      ban.user.id === needle,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchInput
          variant="boxed"
          className="flex-1"
          value={query}
          placeholder="Pesquisar por nome, usuário ou ID"
          aria-label="Pesquisar banimentos"
          onChange={(event) => setQuery(event.target.value)}
          aside={bans.length}
        />
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          Atualizar
        </Button>
      </div>

      {visible.length === 0 ? (
        <SettingsEmpty
          icon={<Hammer size={20} aria-hidden />}
          title={loading ? 'Carregando…' : bans.length === 0 ? 'Ninguém está banido' : 'Nenhum resultado'}
          description={
            bans.length === 0
              ? 'Usuários banidos aparecem aqui e podem ter o banimento revogado a qualquer momento.'
              : 'Tente outro nome, usuário ou ID.'
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-md border border-divider bg-app-alt">
          {visible.map((ban) => (
            <li key={ban.user.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={ban.user.displayName} src={ban.user.avatarUrl} color={ban.user.accentColor} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-heading">{ban.user.displayName}</span>
                  <span className="truncate text-xs text-faint">@{ban.user.username}</span>
                </div>
                <div className="truncate text-[11px] text-muted">
                  {ban.reason ? `Motivo: ${ban.reason}` : 'Sem motivo informado'}
                  {ban.moderator ? ` · por ${ban.moderator.displayName}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-faint">{formatExpiry(ban)}</span>
              <Button variant="secondary" size="sm" onClick={() => void revoke(ban)} loading={revoking === ban.user.id}>
                <Undo2 size={14} aria-hidden />
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
