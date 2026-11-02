import { useEffect, useMemo, useState } from 'react';
import { Image, RotateCcw, Trash2 } from 'lucide-react';
import {
  MAX_GUILD_DESCRIPTION_LENGTH,
  MAX_GUILD_NAME_LENGTH,
  type GuildWithDetails,
} from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';
import { toast } from '../../components/ui/Toast';
import { GuildBannerUploader, GuildColorPicker, GuildIconUploader } from './GuildImageFields';
import { SettingsField, SettingsSection } from './SettingsSection';

const ICON_COLORS = ['#fbbf24', '#f59e0b', '#4ade80', '#22d3ee', '#f87171', '#a78bfa', '#f472b6', '#e4e4e7'];

interface OverviewTabProps {
  guild: GuildWithDetails;
  canManageGuild: boolean;
}

interface Draft {
  name: string;
  description: string;
  iconColor: string;
}

const draftOf = (guild: GuildWithDetails): Draft => ({
  name: guild.name,
  description: guild.description ?? '',
  iconColor: guild.iconColor,
});

export function OverviewTab({ guild, canManageGuild }: OverviewTabProps) {
  const refreshGuild = useChatStore((state) => state.refreshGuild);
  const [draft, setDraft] = useState<Draft>(() => draftOf(guild));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftOf(guild));
  }, [guild.name, guild.description, guild.iconColor]);

  const original = useMemo(() => draftOf(guild), [guild.name, guild.description, guild.iconColor]);
  const trimmedName = draft.name.trim();
  const trimmedDescription = draft.description.trim();
  const nameInvalid = trimmedName.length === 0 || trimmedName.length > MAX_GUILD_NAME_LENGTH;
  const dirty =
    trimmedName !== original.name ||
    trimmedDescription !== original.description.trim() ||
    draft.iconColor !== original.iconColor;
  const canSave = canManageGuild && dirty && !nameInvalid;
  const readOnly = !canManageGuild;

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await api.guilds.update(guild.id, {
        name: trimmedName,
        description: trimmedDescription || null,
        iconColor: draft.iconColor,
      });
      await refreshGuild(guild.id);
      toast.success('Configurações salvas');
    } catch (error) {
      toast.error('Falha ao salvar', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'icon' | 'banner', file: File) => {
    try {
      await api.guilds.uploadImage(guild.id, kind, file);
      await refreshGuild(guild.id);
      toast.success(kind === 'icon' ? 'Ícone atualizado' : 'Banner atualizado');
    } catch (error) {
      toast.error('Falha no upload', error instanceof Error ? error.message : undefined);
    }
  };

  const clear = async (kind: 'icon' | 'banner') => {
    try {
      await api.guilds.update(guild.id, kind === 'icon' ? { iconUrl: null } : { bannerUrl: null });
      await refreshGuild(guild.id);
      toast.success(kind === 'icon' ? 'Ícone removido' : 'Banner removido');
    } catch (error) {
      toast.error('Falha ao remover', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? (
        <p className="rounded-md border border-line bg-tint px-3 py-2 text-[12px] text-muted">
          Estas são as informações do servidor. Você precisa da permissão <strong className="font-semibold text-normal">Gerenciar servidor</strong> para alterá-las.
        </p>
      ) : null}

      <SettingsSection title="Imagens" description="Ícone e banner aparecem no cabeçalho, na lista de servidores e no convite.">
        <div className="relative">
          <GuildBannerUploader
            bannerUrl={guild.bannerUrl}
            color={draft.iconColor}
            disabled={readOnly}
            onFile={(file) => upload('banner', file)}
          />
          <div className="absolute -bottom-9 left-4">
            <GuildIconUploader
              name={trimmedName || guild.name}
              iconUrl={guild.iconUrl}
              iconColor={draft.iconColor}
              disabled={readOnly}
              onFile={(file) => upload('icon', file)}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-[104px]">
          <span className="flex items-center gap-1.5 text-[12px] text-faint">
            <Image size={12} aria-hidden />
            PNG, JPG ou GIF · até 4 MB
          </span>
          <div className="ml-auto flex items-center gap-1">
            {guild.bannerUrl ? (
              <RemoveButton label="Remover banner" disabled={readOnly} onClick={() => void clear('banner')} />
            ) : null}
            {guild.iconUrl ? (
              <RemoveButton label="Remover ícone" disabled={readOnly} onClick={() => void clear('icon')} />
            ) : null}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Informações do servidor" description="Aparecem no cabeçalho dos canais e na lista de servidores.">
        <div className="flex flex-col gap-4">
          <SettingsField
            label="Nome do servidor"
            htmlFor="guild-name"
            error={nameInvalid ? 'Informe um nome.' : undefined}
            hint={`De 2 a ${MAX_GUILD_NAME_LENGTH} caracteres.`}
            aside={`${draft.name.length}/${MAX_GUILD_NAME_LENGTH}`}
          >
            <Input
              id="guild-name"
              value={draft.name}
              maxLength={MAX_GUILD_NAME_LENGTH}
              invalid={nameInvalid}
              disabled={readOnly}
              className="bg-input-sunken"
              onChange={(event) => update({ name: event.target.value })}
            />
          </SettingsField>
          <SettingsField
            label="Descrição"
            htmlFor="guild-description"
            hint="Um resumo curto do que acontece por aqui."
            aside={`${draft.description.length}/${MAX_GUILD_DESCRIPTION_LENGTH}`}
          >
            <Textarea
              id="guild-description"
              rows={3}
              value={draft.description}
              maxLength={MAX_GUILD_DESCRIPTION_LENGTH}
              disabled={readOnly}
              className="bg-input-sunken"
              onChange={(event) => update({ description: event.target.value })}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Cor de destaque"
        description={
          guild.iconUrl
            ? 'Usada enquanto o ícone carrega e nas bordas do avatar.'
            : 'Define a cor do ícone enquanto nenhuma imagem foi enviada.'
        }
      >
        <div className="flex flex-wrap items-center gap-4">
          <GuildColorPicker
            value={draft.iconColor}
            colors={ICON_COLORS}
            disabled={readOnly}
            onChange={(iconColor) => update({ iconColor })}
          />
          <span className="flex items-center gap-2 rounded-sm bg-input-sunken px-2.5 py-1 text-xs text-muted">
            <span className="size-3 rounded-full" style={{ backgroundColor: draft.iconColor }} aria-hidden />
            <span className="font-mono uppercase tracking-wide">{draft.iconColor}</span>
          </span>
        </div>
      </SettingsSection>

      <div className="grid grid-cols-2 gap-3">
        <MetaCard label="Identificador do servidor">
          <code className="selectable truncate font-mono text-[13px] text-normal">{guild.id}</code>
        </MetaCard>
        <MetaCard label="Criado em">
          <span className="text-[13px] text-normal">
            {new Date(guild.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>
        </MetaCard>
      </div>

      {readOnly ? null : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-tint px-4 py-3">
          <span className={dirty ? 'text-[13px] text-yellow' : 'text-[13px] text-muted'}>
            {dirty ? 'Você tem alterações não salvas.' : 'Tudo salvo.'}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(original)} aria-disabled={!dirty || undefined} className={!dirty ? 'pointer-events-none opacity-40' : undefined}>
              <RotateCcw size={13} aria-hidden /> Redefinir
            </Button>
            {/* aria-disabled keeps the button mounted so focus never falls back to <body> and closes the dialog */}
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save()}
              loading={saving}
              aria-disabled={!canSave || undefined}
              className={!canSave && !saving ? 'pointer-events-none opacity-60' : undefined}
            >
              Salvar alterações
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RemoveButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="text-red hover:bg-red/10 hover:text-red"
    >
      <Trash2 size={13} aria-hidden /> {label}
    </Button>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-divider bg-app-alt px-4 py-3">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  );
}
