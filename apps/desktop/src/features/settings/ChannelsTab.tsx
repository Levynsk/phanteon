import type { Channel } from '@phanteon/shared';
import { ChevronDown, ChevronUp, Folder, Hash, Lock, Plus, Trash2, Volume2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api, type CategoryInput } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Input } from '../../components/ui/Input';
import { toast } from '../../components/ui/Toast';
import { Permission } from '@phanteon/shared';
import { ChannelAccessEditor, type AccessDraft } from './ChannelAccessEditor';
import { SettingsField, SettingsSection } from './SettingsSection';

const PUBLIC_ACCESS: AccessDraft = { visibility: 'public', roleIds: [] };

/**
 * What the category save should send. The access editor starts on an empty draft and
 * fills itself from the loaded overrides; saving meanwhile wrote that empty draft back
 * and cleared every role's access — so an unloaded draft sends no access fields at all.
 */
export function categoryUpdatePayload(
  name: string,
  fallbackName: string,
  access: AccessDraft,
  loaded: boolean,
): Partial<CategoryInput> & { name: string } {
  const payload = { name: name.trim() || fallbackName };
  if (!loaded) return payload;
  return { ...payload, visibility: access.visibility, roleIds: access.roleIds };
}

export function ChannelsTab({ guildId }: { guildId: string }) {
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const setChannelInGuild = useChatStore((state) => state.setChannelInGuild);
  const removeChannelFromGuild = useChatStore((state) => state.removeChannelFromGuild);
  const refreshGuild = useChatStore((state) => state.refreshGuild);
  const openModal = useUiStore((state) => state.openModal);
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);

  const canManage = guild ? canInGuild(guild, Permission.ManageChannels) : false;

  // the store keeps channels sorted by position, so grouping here follows the drag order
  const ordered = useMemo(() => guild?.channels ?? [], [guild?.channels]);

  const sections = useMemo(() => {
    const categories = ordered.filter((channel) => channel.type === 'category');
    const loose = ordered.filter((channel) => channel.type !== 'category' && !channel.categoryId);
    const groups = [{ category: null as Channel | null, channels: loose }];
    for (const category of categories) {
      groups.push({
        category,
        channels: ordered.filter((channel) => channel.type !== 'category' && channel.categoryId === category.id),
      });
    }
    const orphans = ordered.filter(
      (channel) =>
        channel.type !== 'category' &&
        channel.categoryId &&
        !categories.some((category) => category.id === channel.categoryId),
    );
    if (orphans.length > 0) groups.push({ category: null, channels: orphans });
    return groups;
  }, [ordered]);

  if (!guild) return null;

  const persistOrder = async (items: { id: string; categoryId: string | null }[]) => {
    try {
      const { channels } = await api.guilds.reorderChannels(guildId, items);
      for (const channel of channels) setChannelInGuild(guildId, channel);
    } catch (error) {
      toast.error('Não foi possível reordenar', error instanceof Error ? error.message : undefined);
    }
  };

  /** Moves one channel or category up/down inside the flat list the server keeps. */
  const shift = async (channel: Channel, direction: -1 | 1) => {
    const flat = ordered;
    const index = flat.findIndex((item) => item.id === channel.id);
    const neighbourIndex = index + direction;
    if (index < 0 || neighbourIndex < 0 || neighbourIndex >= flat.length) return;

    const next = [...flat];
    const [moved] = next.splice(index, 1);
    next.splice(neighbourIndex, 0, moved!);

    // a category travels with its children, so keep each child glued to its parent
    const order = channel.type === 'category' ? reglueChildren(next) : next;
    await persistOrder(order.map((item) => ({ id: item.id, categoryId: item.categoryId ?? null })));
  };

  const createCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    setCreating(true);
    try {
      const { channel } = await api.guilds.createCategory(guildId, { name });
      setChannelInGuild(guildId, channel);
      setNewCategory('');
      toast.success(`Categoria ${name} criada`);
    } catch (error) {
      toast.error('Falha ao criar categoria', error instanceof Error ? error.message : undefined);
    } finally {
      setCreating(false);
    }
  };

  const openCreate = (type: 'text' | 'voice', categoryId: string | null) =>
    openModal({ kind: 'create-channel', guildId, type, categoryId });

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <SettingsSection title="Nova categoria" description="Agrupe canais por assunto, equipe ou arquivo.">
          <div className="flex items-start gap-2">
            <SettingsField label="Nome" htmlFor="new-category" className="flex-1">
              <Input
                id="new-category"
                placeholder="Projetos, Staff, Arquivo…"
                value={newCategory}
                className="bg-input-sunken"
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createCategory();
                }}
              />
            </SettingsField>
            <ActionButton
              className="mt-[19px]"
              disabled={!newCategory.trim() || creating}
              onClick={() => void createCategory()}
            >
              <Plus size={14} aria-hidden /> Criar
            </ActionButton>
          </div>
        </SettingsSection>
      ) : null}

      <div className="flex flex-col gap-3">
        {sections.map((section) => (
          <section key={section.category?.id ?? 'loose'} className="overflow-hidden rounded-md border border-divider">
            <header className="flex items-center gap-2 border-b border-divider bg-tint px-3 py-2">
              {section.category ? <Folder size={14} className="shrink-0 text-muted" aria-hidden /> : null}
              <h3 className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-wide text-muted">
                {section.category?.name ?? 'Sem categoria'}
              </h3>
              {section.category?.private ? <PrivateBadge /> : null}
              {section.category && canManage ? (
                <div className="flex items-center gap-0.5">
                  <IconButton label="Mover categoria para cima" onClick={() => void shift(section.category!, -1)}>
                    <ChevronUp size={14} />
                  </IconButton>
                  <IconButton label="Mover categoria para baixo" onClick={() => void shift(section.category!, 1)}>
                    <ChevronDown size={14} />
                  </IconButton>
                  <IconButton
                    label="Criar canal nesta categoria"
                    onClick={() => openCreate('text', section.category!.id)}
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
              ) : null}
            </header>

            {section.category ? (
              <CategoryRow
                key={section.category.id}
                category={section.category}
                guildId={guildId}
                canManage={canManage}
                onDeleted={() => removeChannelFromGuild(guildId, section.category!.id)}
                onSynced={async () => {
                  await refreshGuild(guildId);
                }}
              />
            ) : null}

            <ul className="divide-y divide-divider/60">
              {section.channels.length === 0 ? (
                <li className="px-3 py-3 text-[12px] text-faint">Nenhum canal nesta categoria.</li>
              ) : null}
              {section.channels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  guildId={guildId}
                  canManage={canManage}
                  onDeleted={() => removeChannelFromGuild(guildId, channel.id)}
                />
              ))}
            </ul>

            {canManage ? (
              <footer className="flex items-center gap-4 border-t border-divider/60 px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-heading"
                  onClick={() => openCreate('text', section.category?.id ?? null)}
                >
                  <Hash size={13} aria-hidden /> Texto
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[12px] font-medium text-muted transition-colors hover:text-heading"
                  onClick={() => openCreate('voice', section.category?.id ?? null)}
                >
                  <Volume2 size={13} aria-hidden /> Voz
                </button>
              </footer>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  guildId,
  canManage,
  onDeleted,
  onSynced,
}: {
  category: Channel;
  guildId: string;
  canManage: boolean;
  onDeleted: () => void;
  onSynced: () => Promise<void> | void;
}) {
  const rename = useChatStore((state) => state.setChannelInGuild);
  const [name, setName] = useState(category.name);
  const [access, setAccess] = useState<AccessDraft>({
    visibility: category.private ? 'private' : 'public',
    roleIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const guild = useChatStore((state) => state.guildDetails[guildId]);

  const save = async () => {
    setSaving(true);
    try {
      const { channel } = await api.guilds.updateCategory(
        guildId,
        category.id,
        categoryUpdatePayload(name, category.name, access, accessLoaded),
      );
      rename(guildId, channel);
      toast.success('Categoria atualizada');
    } catch (error) {
      toast.error('Falha ao atualizar a categoria', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    openConfirm({
      title: 'Excluir categoria',
      description: `Excluir "${category.name}"? Os canais continuam existindo e vão para o topo da lista.`,
      confirmLabel: 'Excluir categoria',
      onConfirm: async () => {
        await api.guilds.removeCategory(guildId, category.id);
        onDeleted();
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 border-b border-divider/60 bg-tint px-3 py-3">
      <div className="flex items-start gap-2">
        <SettingsField label="Nome da categoria" htmlFor={`category-${category.id}`} className="flex-1">
          <Input
            id={`category-${category.id}`}
            value={name}
            disabled={!canManage}
            className="bg-input-sunken"
            onChange={(event) => setName(event.target.value)}
          />
        </SettingsField>
        <ActionButton disabled={!canManage || saving} onClick={() => void save()}>
          {saving ? 'Salvando…' : 'Salvar'}
        </ActionButton>
        {canManage ? (
          <IconButton label="Excluir categoria" tone="danger" onClick={remove}>
            <Trash2 size={15} />
          </IconButton>
        ) : null}
      </div>
      <ChannelAccessEditor
        channel={category}
        guildId={guildId}
        roles={guild?.roles ?? []}
        value={access}
        onChange={setAccess}
        onLoaded={setAccessLoaded}
        onSynced={() => void onSynced()}
        readOnly={!canManage}
      />
    </div>
  );
}

function ChannelRow({
  channel,
  guildId,
  canManage,
  onDeleted,
}: {
  channel: Channel;
  guildId: string;
  canManage: boolean;
  onDeleted: () => void;
}) {
  const openModal = useUiStore((state) => state.openModal);
  const Icon = channel.type === 'voice' ? Volume2 : Hash;
  const removeChannelFromGuild = useChatStore((state) => state.removeChannelFromGuild);

  return (
    <li className="flex items-center gap-2 bg-app-alt px-3 py-2">
      <Icon size={15} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-normal">{channel.name}</span>
      {channel.type === 'voice' ? <span className="shrink-0 text-[11px] text-faint">voz</span> : null}
      {channel.private ? <PrivateBadge /> : null}
      <button
        type="button"
        className="rounded-sm px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-hover hover:text-heading"
        onClick={() => openModal({ kind: 'channel-settings', guildId, channelId: channel.id })}
      >
        Editar
      </button>
      {canManage ? (
        <IconButton
          label={`Excluir ${channel.name}`}
          tone="danger"
          onClick={() =>
            openConfirm({
              title: 'Excluir canal',
              description: `Excluir #${channel.name}? Todas as mensagens serão removidas.`,
              confirmLabel: 'Excluir canal',
              onConfirm: async () => {
                await api.channels.remove(channel.id);
                removeChannelFromGuild(guildId, channel.id);
                onDeleted();
              },
            })
          }
        >
          <Trash2 size={14} />
        </IconButton>
      ) : null}
    </li>
  );
}

function PrivateBadge() {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-xs bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warn">
      <Lock size={10} aria-hidden />
      privado
    </span>
  );
}

function ActionButton({
  children,
  disabled,
  onClick,
  className,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-10 shrink-0 items-center gap-1.5 rounded-sm bg-brand px-3 text-sm font-semibold text-on-brand transition-opacity hover:opacity-90 disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  children,
  onClick,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover',
        tone === 'danger' ? 'hover:text-red' : 'hover:text-heading',
      )}
    >
      {children}
    </button>
  );
}

/** Keeps every category immediately followed by its own channels. */
function reglueChildren(channels: Channel[]): Channel[] {
  const categories = channels.filter((channel) => channel.type === 'category');
  const others = channels.filter((channel) => channel.type !== 'category');
  const loose = others.filter((channel) => !channel.categoryId);
  const result = [...loose];
  for (const category of categories) {
    result.push(category, ...others.filter((channel) => channel.categoryId === category.id));
  }
  const known = new Set(result.map((channel) => channel.id));
  result.push(...others.filter((channel) => !known.has(channel.id)));
  return result;
}

function openConfirm(input: { title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> }) {
  useUiStore.getState().openModal({ kind: 'confirm', ...input });
}
