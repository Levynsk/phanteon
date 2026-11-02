import { useMemo, useState } from 'react';
import { Crown, UserRound } from 'lucide-react';
import type { GuildMember } from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/SearchInput';
import { StatusBadge } from '../../components/ui/Status';
import { Switch } from '../../components/ui/Switch';
import { toast } from '../../components/ui/Toast';
import { SettingsEmpty, SettingsSection } from './SettingsSection';

interface MembersTabProps {
  guildId: string;
  canManageMembers: boolean;
  myPosition: number;
}

export function MembersTab({ guildId, canManageMembers, myPosition }: MembersTabProps) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const refreshGuild = useChatStore((state) => state.refreshGuild);
  const setMemberRoles = useChatStore((state) => state.setMemberRoles);
  const currentUser = useAuthStore((state) => state.user);
  const [query, setQuery] = useState('');
  // the chosen person stays selected even while the search filters them out
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const members = useMemo(() => {
    const all = [...(guild?.members ?? [])].sort(
      (a, b) => b.position - a.position || a.user.displayName.localeCompare(b.user.displayName),
    );
    if (!needle) return all;
    return all.filter(
      (m) => m.user.displayName.toLowerCase().includes(needle) || m.user.username.toLowerCase().includes(needle),
    );
  }, [guild?.members, needle]);

  const selected =
    (selectedId ? guild?.members.find((m) => m.user.id === selectedId) : undefined) ?? members[0] ?? null;

  const roles = useMemo(
    () => (guild?.roles ?? []).filter((r) => !r.isEveryone).sort((a, b) => b.position - a.position),
    [guild?.roles],
  );
  const topRole = (member: GuildMember) =>
    member.roleIds.map((id) => guild?.roles.find((r) => r.id === id)).find((r) => r && !r.isEveryone);

  const isOwnerTarget = !!guild && selected?.user.id === guild.ownerId;
  const canEditSelected =
    canManageMembers &&
    !!selected &&
    !!guild &&
    (selected.user.id !== guild.ownerId || guild.isOwner) &&
    (guild.isOwner || selected.position < myPosition);
  const reason = !canManageMembers
    ? 'Você não tem permissão para gerenciar membros neste servidor.'
    : isOwnerTarget && !guild?.isOwner
      ? 'O dono tem acesso total; apenas ele pode escolher os próprios cargos.'
      : selected && guild && !guild.isOwner && selected.position >= myPosition
        ? 'Você só pode alterar cargos de membros abaixo de você.'
        : null;

  const toggleRole = async (member: GuildMember, roleId: string) => {
    if (!guild) return;
    const next = member.roleIds.includes(roleId)
      ? member.roleIds.filter((id) => id !== roleId)
      : [...member.roleIds, roleId];
    setPendingRole(roleId);
    try {
      await api.roles.setMemberRoles(guildId, member.user.id, next);
      setMemberRoles(guildId, member.user.id, next);
      // the member's position drives hierarchy checks elsewhere: refresh in the background
      void refreshGuild(guildId).catch(() => undefined);
    } catch (error) {
      toast.error('Não foi possível alterar os cargos', error instanceof Error ? error.message : undefined);
    } finally {
      setPendingRole(null);
    }
  };

  if (!guild) return null;

  return (
    <div className="grid h-[min(62vh,560px)] min-h-[380px] grid-cols-[minmax(190px,240px)_1fr] gap-4">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-divider bg-app-alt">
        <SearchInput
          variant="boxed"
          className="h-auto rounded-none border-0 border-b border-divider bg-transparent px-2.5 py-2 focus-within:ring-0"
          inputClassName="text-[13px]"
          value={query}
          placeholder="Pesquisar membros"
          aria-label="Pesquisar membros"
          onChange={(e) => setQuery(e.target.value)}
          aside={members.length}
        />
        <ul className="min-h-0 flex-1 overflow-y-auto p-1 [scrollbar-width:thin]">
          {members.length === 0 ? (
            <li className="px-2 py-6 text-center text-xs text-muted">Nenhum membro encontrado.</li>
          ) : (
            members.map((member) => {
              const role = topRole(member);
              const active = selected?.user.id === member.user.id;
              return (
                <li key={member.user.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(member.user.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors',
                      active ? 'bg-selected' : 'hover:bg-hover/60',
                    )}
                  >
                    <span className="relative inline-flex shrink-0">
                      <Avatar name={member.user.displayName} src={member.user.avatarUrl} color={member.user.accentColor} size="sm" />
                      <StatusBadge status={member.online ? member.user.status : 'offline'} ring="surface-alt" size="sm" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium" style={{ color: role?.color }}>
                        {member.user.displayName}
                      </span>
                      <span className="block truncate text-[11px] text-faint">
                        {guild.ownerId === member.user.id ? 'Dono' : (role?.name ?? 'Sem cargo')}
                      </span>
                    </span>
                    {guild.ownerId === member.user.id ? <Crown size={12} className="shrink-0 text-yellow" aria-label="Dono" /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </aside>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {selected ? (
          <>
            <div className="flex items-center gap-3 rounded-md border border-divider bg-app-alt p-3">
              <Avatar name={selected.user.displayName} src={selected.user.avatarUrl} color={selected.user.accentColor} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-heading">{selected.user.displayName}</span>
                  {selected.user.id === currentUser?.id ? <Badge variant="success" className="text-[10px]">você</Badge> : null}
                  {guild.ownerId === selected.user.id ? (
                    <Badge variant="neutral" className="border-yellow/40 bg-yellow/15 text-[10px] uppercase text-yellow">dono</Badge>
                  ) : null}
                </div>
                <span className="truncate text-xs text-muted">@{selected.user.username}</span>
              </div>
              <div className="text-right text-[11px] text-muted">
                <div>{selected.online ? 'Online' : 'Offline'}</div>
                <div>Entrou em {new Date(selected.joinedAt).toLocaleDateString('pt-BR')}</div>
              </div>
            </div>

            <SettingsSection
              title="Cargos"
              description={reason ?? 'Marque os cargos que esta pessoa deve ter. As mudanças são aplicadas na hora.'}
            >
              {roles.length === 0 ? (
                <SettingsEmpty icon={<UserRound size={18} aria-hidden />} title="Nenhum cargo disponível" />
              ) : (
                <ul className="flex flex-col">
                  {roles.map((role) => {
                    const checked = selected.roleIds.includes(role.id);
                    const forbidden = !canEditSelected || (!guild.isOwner && role.position >= myPosition);
                    return (
                      <li
                        key={role.id}
                        className={cn(
                          'flex items-center gap-3 border-t border-line py-2 first:border-t-0 first:pt-0',
                          forbidden && 'opacity-55',
                        )}
                      >
                        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: role.color }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-normal">{role.name}</span>
                        {role.isSystem ? <span className="shrink-0 text-[10px] uppercase text-faint">sistema</span> : null}
                        <Switch
                          checked={checked}
                          disabled={forbidden || pendingRole === role.id}
                          aria-label={`Cargo ${role.name}`}
                          onCheckedChange={() => void toggleRole(selected, role.id)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </SettingsSection>
          </>
        ) : (
          <SettingsEmpty icon={<UserRound size={18} aria-hidden />} title="Selecione um membro" />
        )}
      </div>
    </div>
  );
}
