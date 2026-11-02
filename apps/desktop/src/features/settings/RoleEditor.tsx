import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2, RotateCcw, Users } from 'lucide-react';
import {
  MAX_ROLE_NAME_LENGTH,
  PERMISSION_CATALOG,
  hasPermission,
  type GuildMember,
  type GuildRoleEntity,
  type PermissionMeta,
  type PermissionFlag,
  type RoleSummary,
} from '@phanteon/shared';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { inkOn } from '../../lib/format';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Switch } from '../../components/ui/Switch';
import { toast } from '../../components/ui/Toast';
import { SettingsEmpty, SettingsField, SettingsSection, SettingsToggle } from './SettingsSection';
import { ROLE_COLORS } from './role-colors';

interface RoleEditorProps {
  guildId: string;
  role: RoleSummary;
  readOnly: boolean;
  canDelete: boolean;
  isOwner: boolean;
  members: GuildMember[];
  onSaved: (role: GuildRoleEntity) => void;
  onDeleted: () => Promise<void> | void;
  onRemoveMember?: (userId: string) => Promise<void>;
}

const GROUPS = ['geral', 'membros', 'canais', 'mensagens', 'voz'] as const;

const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = {
  geral: 'Geral do servidor',
  membros: 'Membros e moderação',
  canais: 'Canais',
  mensagens: 'Mensagens',
  voz: 'Voz',
};

/** Matches the server's fallback role color, offered as Discord's "Cor padrão". */
const DEFAULT_ROLE_COLOR = '#99aab5';

export function RoleEditor({
  guildId,
  role,
  readOnly,
  canDelete,
  isOwner,
  members,
  onSaved,
  onDeleted,
  onRemoveMember,
}: RoleEditorProps) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color);
  const [permissions, setPermissions] = useState(role.permissions);
  const [saving, setSaving] = useState(false);

  // reset the draft only when another role is opened (or this one was reloaded from the server)
  useEffect(() => {
    setName(role.name);
    setColor(role.color);
    setPermissions(role.permissions);
  }, [role.id, role.name, role.color, role.permissions]);

  const nameInvalid = !role.isEveryone && name.trim().length === 0;
  const dirty = name.trim() !== role.name || color !== role.color || permissions !== role.permissions;
  const canSave = !readOnly && dirty && !nameInvalid && name.trim().length <= MAX_ROLE_NAME_LENGTH;

  // read-only viewers only get to see what the role actually has
  const catalog = useMemo(
    () => PERMISSION_CATALOG.filter((meta) => isOwner || !readOnly || hasPermission(role.permissions, meta.flag)),
    [isOwner, readOnly, role.permissions],
  );
  const granted = PERMISSION_CATALOG.filter((meta) => hasPermission(permissions, meta.flag)).length;

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const { role: saved } = await api.roles.update(guildId, role.id, {
        ...(role.isEveryone ? {} : { name: name.trim(), color }),
        permissions,
      });
      onSaved(saved);
      toast.success('Cargo salvo');
    } catch (error) {
      toast.error('Falha ao salvar cargo', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.roles.remove(guildId, role.id);
      await onDeleted();
      toast.success('Cargo excluído');
    } catch (error) {
      toast.error('Falha ao excluir cargo', error instanceof Error ? error.message : undefined);
    }
  };

  const toggle = (flag: PermissionFlag, enabled: boolean) => {
    setPermissions((current) => (enabled ? current | flag : current & ~flag));
  };

  const setGroup = (items: readonly PermissionMeta[], enabled: boolean) => {
    const mask = items.reduce((acc, meta) => acc | meta.flag, 0);
    setPermissions((current) => (enabled ? current | mask : current & ~mask));
  };

  const reset = () => {
    setName(role.name);
    setColor(role.color);
    setPermissions(role.permissions);
  };

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? (
        <p className="rounded-md border border-line bg-tint px-3 py-2 text-[12px] text-muted">
          Você só pode visualizar este cargo.
        </p>
      ) : null}

      <SettingsSection>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
            <SettingsField
              label="Nome do cargo"
              htmlFor={`role-name-${role.id}`}
              error={nameInvalid ? 'Informe um nome.' : undefined}
              aside={`${name.length}/${MAX_ROLE_NAME_LENGTH}`}
            >
              <Input
                id={`role-name-${role.id}`}
                value={role.isEveryone ? '@everyone' : name}
                maxLength={MAX_ROLE_NAME_LENGTH}
                invalid={nameInvalid}
                disabled={readOnly || role.isEveryone}
                className="bg-input-sunken"
                onChange={(event) => setName(event.target.value)}
              />
            </SettingsField>
            <span className="flex h-10 items-center rounded-sm bg-input-sunken px-3" aria-label="Prévia do cargo">
              <span
                className="truncate rounded-xs px-2 py-0.5 text-[13px] font-semibold"
                style={{ backgroundColor: color, color: inkOn(color) }}
              >
                {role.isEveryone ? '@everyone' : name.trim() || 'Cargo'}
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Cor do cargo</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor do cargo">
              <ColorSwatch
                value={DEFAULT_ROLE_COLOR}
                selected={color === DEFAULT_ROLE_COLOR}
                label="Cor padrão"
                disabled={readOnly}
                onSelect={setColor}
              />
              {ROLE_COLORS.map((option) => (
                <ColorSwatch
                  key={option}
                  value={option}
                  selected={color === option}
                  label={`Cor ${option}`}
                  disabled={readOnly}
                  onSelect={setColor}
                />
              ))}
            </div>
            <p className="text-[12px] text-muted">Os membros com este cargo aparecem com essa cor na lista.</p>
          </div>

          {role.isEveryone ? (
            <p className="rounded-sm border border-line bg-tint px-3 py-2 text-[12px] leading-relaxed text-muted">
              O cargo <strong className="font-semibold text-normal">@everyone</strong> é aplicado a todos os membros
              do servidor e não pode ser renomeado. Os demais cargos somam permissões a ele.
            </p>
          ) : null}
          {role.isSystem ? (
            <p className="text-[12px] text-faint">Cargo padrão do sistema — pode ser editado, mas não excluído.</p>
          ) : null}
        </div>
      </SettingsSection>

      {GROUPS.map((group) => {
        const items = catalog.filter((meta) => meta.group === group);
        if (items.length === 0) return null;
        const on = items.filter((meta) => hasPermission(permissions, meta.flag)).length;
        const allOn = on === items.length;
        return (
          <SettingsSection
            key={group}
            title={GROUP_LABEL[group]}
            actions={
              <div className="flex items-center gap-3">
                <span className="text-[11px] tabular-nums text-faint">
                  {on}/{items.length}
                </span>
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => setGroup(items, !allOn)}
                    className="rounded-xs px-1.5 py-0.5 text-[12px] font-medium text-link hover:underline"
                  >
                    {allOn ? 'Desmarcar todos' : 'Marcar todos'}
                  </button>
                )}
              </div>
            }
          >
            <div className="flex flex-col">
              {items.map((meta) => (
                <SettingsToggle
                  key={meta.key}
                  label={meta.label}
                  hint={meta.description}
                  control={
                    <Switch
                      checked={hasPermission(permissions, meta.flag)}
                      disabled={readOnly}
                      aria-label={meta.label}
                      onCheckedChange={(value) => toggle(meta.flag, value)}
                    />
                  }
                />
              ))}
            </div>
          </SettingsSection>
        );
      })}

      <SettingsSection
        title={`Membros com este cargo · ${members.length}`}
        description={members.length === 0 ? 'Ninguém tem este cargo ainda.' : undefined}
      >
        {members.length === 0 ? (
          <SettingsEmpty
            icon={<Plus size={18} aria-hidden />}
            title="Ninguém por aqui"
            description="Atribua este cargo na aba Membros: escolha uma pessoa e marque o cargo na lista."
          />
        ) : (
          <ul className="flex flex-col">
            {members.map((member) => (
              <li key={member.user.id} className="group flex items-center gap-2 border-t border-line py-1.5 first:border-t-0 first:pt-0">
                <Avatar name={member.user.displayName} src={member.user.avatarUrl} color={member.user.accentColor} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-heading">{member.user.displayName}</span>
                <span className="truncate text-xs text-muted">@{member.user.username}</span>
                {onRemoveMember ? (
                  <button
                    type="button"
                    aria-label={`Remover cargo de ${member.user.displayName}`}
                    title="Remover cargo"
                    className="rounded-xs p-1 text-muted opacity-0 transition-opacity hover:bg-tint-strong hover:text-red group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void onRemoveMember(member.user.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {readOnly ? null : (
        <div className="flex items-center gap-2 rounded-md border border-line bg-tint px-4 py-3">
          <span className="flex items-center gap-1.5 rounded-full bg-tint-strong px-2 py-0.5 text-[11px] font-semibold text-muted">
            <Users size={11} aria-hidden /> {granted} de {PERMISSION_CATALOG.length} permissões
          </span>
          {canDelete ? (
            <Button size="sm" variant="ghost" className="text-red hover:bg-red/10 hover:text-red" onClick={() => void remove()}>
              <Trash2 size={14} aria-hidden /> Excluir cargo
            </Button>
          ) : null}
          <div className="flex-1" />
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              <RotateCcw size={13} aria-hidden /> Redefinir
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            onClick={() => void save()}
            loading={saving}
            aria-disabled={!canSave || undefined}
            className={cn(!canSave && !saving && 'pointer-events-none opacity-60')}
          >
            Salvar alterações
          </Button>
        </div>
      )}
    </div>
  );
}

function ColorSwatch({
  value,
  selected,
  label,
  disabled,
  onSelect,
}: {
  value: string;
  selected: boolean;
  label: string;
  disabled: boolean;
  onSelect: (color: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={value}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={cn(
        'flex size-8 items-center justify-center rounded-full border border-line-strong transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40',
        selected && 'ring-2 ring-brand ring-offset-2 ring-offset-app-alt',
      )}
      style={{ backgroundColor: value, color: inkOn(value) }}
    >
      {selected ? <Check size={15} strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}
