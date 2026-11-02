import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { GripVertical, Plus, ShieldOff } from 'lucide-react';
import type { GuildRoleEntity, RoleSummary } from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { toast } from '../../components/ui/Toast';
import { RoleEditor } from './RoleEditor';
import { ROLE_COLORS } from './role-colors';
import { useScrollEdges } from '../../lib/useScrollEdges';

interface RolesTabProps {
  guildId: string;
  canManageRoles: boolean;
  canManageMembers: boolean;
  myPosition: number;
}

export function RolesTab({ guildId, canManageRoles, canManageMembers, myPosition }: RolesTabProps) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const setGuildRoles = useChatStore((state) => state.setGuildRoles);
  const setMemberRoles = useChatStore((state) => state.setMemberRoles);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  // the last role id the store still knows: a server round-trip can briefly resolve it as missing
  const lastSelected = useRef<string | null>(null);

  const roles = useMemo<RoleSummary[]>(
    () =>
      [...(guild?.roles ?? [])]
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          ...role,
          memberCount: guild?.members.filter((member) => member.roleIds.includes(role.id)).length ?? 0,
        })),
    [guild?.roles, guild?.members],
  );

  useEffect(() => {
    if (roles.length === 0) return;
    setSelectedId((current) => {
      if (current && roles.some((role) => role.id === current)) {
        lastSelected.current = current;
        return current;
      }
      const restored = lastSelected.current && roles.some((role) => role.id === lastSelected.current);
      return restored ? lastSelected.current : roles[0]!.id;
    });
  }, [roles]);

  // resolve the editor's role from the raw config so a local save updates in place
  const selectedConfig = guild?.roles.find((role) => role.id === selectedId) ?? null;
  const selected = roles.find((role) => role.id === selectedId) ?? null;
  // a role can be edited when the viewer outranks it (or is the owner)
  const outranks = (role: RoleSummary) => !!guild?.isOwner || role.isEveryone || role.position < myPosition;
  const editable = (role: RoleSummary) => canManageRoles && outranks(role);

  const replaceRole = (id: string, next: GuildRoleEntity) =>
    setGuildRoles(guildId, (guild?.roles ?? []).map((role) => (role.id === id ? next : role)));

  const create = async () => {
    setCreating(true);
    try {
      const { role } = await api.roles.create(guildId, {
        name: 'Novo cargo',
        color: ROLE_COLORS[roles.filter((item) => !item.isEveryone).length % ROLE_COLORS.length],
      });
      setGuildRoles(guildId, [...(guild?.roles ?? []), role]);
      lastSelected.current = role.id;
      setSelectedId(role.id);
      toast.success('Cargo criado');
    } catch (error) {
      toast.error('Falha ao criar cargo', error instanceof Error ? error.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (role: GuildRoleEntity) => {
    try {
      await api.roles.remove(guildId, role.id);
    } catch (error) {
      // already deleted elsewhere (or by a repeated request): the outcome is the same
      if (!(error instanceof ApiError && error.code === 'NOT_FOUND')) throw error;
    }
    const next = (guild?.roles ?? []).filter((item) => item.id !== role.id);
    setGuildRoles(guildId, next);
    lastSelected.current = null;
    setSelectedId([...next].sort((a, b) => b.position - a.position)[0]?.id ?? null);
  };

  const reorder = async (fromId: string, toId: string, after: boolean) => {
    const managed = roles.filter((role) => !role.isEveryone);
    const from = managed.findIndex((role) => role.id === fromId);
    const target = managed.findIndex((role) => role.id === toId);
    if (from < 0 || target < 0 || fromId === toId) return;
    // an owner can drag anything; everyone else only roles they outrank
    if (!guild?.isOwner) {
      const moved = managed[from]!;
      const destination = managed[target]!;
      if (moved.position >= myPosition || destination.position >= myPosition) {
        toast.error('Você só pode mover cargos abaixo do seu.');
        return;
      }
    }

    const next = [...managed];
    const [moved] = next.splice(from, 1);
    const insertAt = next.findIndex((role) => role.id === toId) + (after ? 1 : 0);
    next.splice(insertAt, 0, moved!);

    const previous = guild?.roles ?? [];
    const everyone = previous.filter((role) => role.isEveryone);
    setGuildRoles(guildId, [...next.map((role, index) => ({ ...withoutCount(role), position: next.length - index })), ...everyone]);
    try {
      const { roles: updated } = await api.roles.reorder(guildId, next.map((role) => role.id));
      setGuildRoles(guildId, [...updated, ...everyone]);
    } catch (error) {
      setGuildRoles(guildId, previous);
      toast.error('Não foi possível mover o cargo', error instanceof Error ? error.message : undefined);
    }
  };

  if (!guild) return null;

  return (
    // a fixed-height workspace: the role list and the editor each scroll inside it,
    // instead of the page growing to fit the longest editor
    <div className="grid h-[min(62vh,560px)] min-h-[380px] grid-cols-[minmax(160px,220px)_1fr] gap-4">
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-divider bg-app-alt">
        <header className="flex items-center justify-between border-b border-divider px-3 py-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Cargos · {roles.length}
          </h3>
          {canManageRoles ? (
            <button
              type="button"
              aria-label="Criar cargo"
              title="Criar cargo"
              disabled={creating}
              className="rounded-sm p-1 text-muted transition-colors hover:bg-hover hover:text-heading disabled:opacity-50"
              onClick={() => void create()}
            >
              <Plus size={15} />
            </button>
          ) : null}
        </header>
        <RoleList
          roles={roles}
          selectedId={selectedId}
          draggable={(role) => editable(role) && !role.isEveryone}
          onSelect={setSelectedId}
          onDropRole={reorder}
          dragId={dragId}
          setDragId={setDragId}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
        />
      </aside>

      <section className="min-h-0 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {selected && selectedConfig ? (
          <RoleEditor
            key={selected.id}
            guildId={guildId}
            role={{ ...selectedConfig, memberCount: selected.memberCount }}
            readOnly={!editable(selected)}
            canDelete={!selected.isEveryone && !selected.isSystem && editable(selected)}
            isOwner={!!guild.isOwner}
            members={guild.members.filter((member) => member.roleIds.includes(selected.id))}
            onSaved={(next) => replaceRole(next.id, next)}
            onDeleted={() => remove(selectedConfig)}
            onRemoveMember={
              canManageMembers && (guild.isOwner || selected.position < myPosition)
                ? async (userId) => {
                    const member = guild.members.find((item) => item.user.id === userId);
                    const roleIds = member?.roleIds.filter((id) => id !== selected.id) ?? [];
                    try {
                      await api.roles.setMemberRoles(guildId, userId, roleIds);
                      setMemberRoles(guildId, userId, roleIds);
                    } catch (error) {
                      toast.error('Não foi possível remover o cargo', error instanceof Error ? error.message : undefined);
                    }
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
            <ShieldOff size={28} aria-hidden />
            <p className="text-sm">Selecione um cargo para ver e editar as permissões.</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** The store keeps plain role rows; summaries only add `memberCount`. */
function withoutCount(role: RoleSummary): GuildRoleEntity {
  const { memberCount: _memberCount, ...rest } = role;
  return rest;
}

interface RoleListProps {
  roles: RoleSummary[];
  selectedId: string | null;
  draggable: (role: RoleSummary) => boolean;
  onSelect: (id: string) => void;
  onDropRole: (fromId: string, toId: string, after: boolean) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dropTarget: { id: string; after: boolean } | null;
  setDropTarget: (target: { id: string; after: boolean } | null) => void;
}

function RoleList({
  roles,
  selectedId,
  draggable,
  onSelect,
  onDropRole,
  dragId,
  setDragId,
  dropTarget,
  setDropTarget,
}: RoleListProps) {
  const scroll = useScrollEdges([roles, selectedId]);
  const listRef = useRef<HTMLUListElement>(null);

  const dropAt = (event: DragEvent, role: RoleSummary) => {
    if (!dragId || dragId === role.id) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    event.preventDefault();
    setDropTarget({ id: role.id, after });
  };

  return (
    <div className="relative min-h-0 flex-1">
      <ul
        ref={listRef}
        className="h-full overflow-y-auto p-1 [scrollbar-width:thin]"
        aria-label="Lista de cargos"
        onDragLeave={(event) => {
          if (!listRef.current?.contains(event.relatedTarget as Node)) setDropTarget(null);
        }}
      >
        {roles.map((role) => {
          const canDrag = draggable(role);
          const isDrop = dropTarget?.id === role.id;
          return (
            <li
              key={role.id}
              draggable={canDrag}
              onDragStart={(event) => {
                if (!canDrag) return;
                setDragId(role.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => dropAt(event, role)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId && dropTarget?.id === role.id) onDropRole(dragId, role.id, dropTarget.after);
                setDragId(null);
                setDropTarget(null);
              }}
              className={cn(
                'group relative flex cursor-pointer items-center gap-1 rounded-sm py-1.5 pl-1 pr-2 text-sm transition-colors',
                selectedId === role.id ? 'bg-selected text-heading' : 'text-normal hover:bg-hover/60',
                dragId === role.id && 'opacity-40',
                isDrop && (dropTarget.after ? 'after:inset-x-1 after:bottom-0' : 'before:inset-x-1 before:top-0'),
                isDrop &&
                  'before:pointer-events-none before:absolute before:z-[2] before:h-[2px] before:rounded-full before:bg-brand after:pointer-events-none after:absolute after:z-[2] after:h-[2px] after:rounded-full after:bg-brand',
              )}
              onClick={() => onSelect(role.id)}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center text-faint',
                  canDrag ? 'cursor-grab opacity-0 group-hover:opacity-100' : 'opacity-0',
                )}
                aria-hidden
              >
                <GripVertical size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium" title={role.name}>
                {role.isEveryone ? (
                  <span className="text-muted">@everyone</span>
                ) : (
                  <span style={{ color: role.color }}>{role.name}</span>
                )}
              </span>
              {role.isSystem ? (
                <span className="shrink-0 rounded-xs bg-tint-strong px-1 text-[10px] uppercase tracking-wide text-faint">
                  {role.isEveryone ? 'padrão' : 'sistema'}
                </span>
              ) : (
                <span className="shrink-0 text-[11px] tabular-nums text-muted">{role.memberCount}</span>
              )}
            </li>
          );
        })}
      </ul>
      {scroll.bottom ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-6 bg-gradient-to-t from-app-alt to-transparent" />
      ) : null}
    </div>
  );
}
