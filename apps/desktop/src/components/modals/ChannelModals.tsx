import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hash, Volume2 } from 'lucide-react';
import { Permission } from '@phanteon/shared';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Dialog, DialogContent } from '../ui/Dialog';
import { LabelledField, TextAreaField, TextField } from '../ui/Field';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';
import { ChannelAccessEditor, type AccessDraft } from '../../features/settings/ChannelAccessEditor';

export function CreateChannelModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const guildId = modal?.kind === 'create-channel' ? modal.guildId : null;
  const defaultType = modal?.kind === 'create-channel' ? (modal.type ?? 'text') : 'text';
  const categoryId = modal?.kind === 'create-channel' ? (modal.categoryId ?? null) : null;
  const setChannelInGuild = useChatStore((state) => state.setChannelInGuild);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>(defaultType);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setType(defaultType);
    setName('');
  }, [defaultType, guildId]);

  const submit = async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const { channel } = await api.guilds.createChannel(guildId, { name: name.trim(), type, categoryId });
      setChannelInGuild(guildId, channel);
      close();
      if (channel.type === 'text') navigate(`/app/${guildId}/${channel.id}`);
      const label = channel.type === 'voice' ? channel.name : `#${channel.name}`;
      toast.success(`Canal ${label} criado`);
    } catch (error) {
      toast.error('Falha ao criar canal', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={modal?.kind === 'create-channel'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Criar canal"
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void submit()}
            submitLabel="Criar canal"
            loading={loading}
            submitDisabled={!name.trim()}
          />
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-2">
          <ChannelTypeCard
            icon={Hash}
            title="Texto"
            description="Mensagens, imagens e reações"
            selected={type === 'text'}
            onSelect={() => setType('text')}
          />
          <ChannelTypeCard
            icon={Volume2}
            title="Voz"
            description="Converse e compartilhe a tela (em breve)"
            selected={type === 'voice'}
            onSelect={() => setType('voice')}
          />
        </div>
        <TextField
          label="Nome do canal"
          autoFocus
          placeholder={type === 'text' ? 'novo-canal' : 'sala-de-voz'}
          value={name}
          onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChannelTypeCard({
  icon: Icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: typeof Hash;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors',
        selected ? 'border-brand bg-brand-soft' : 'border-divider hover:border-muted',
      )}
    >
      <span className="flex items-center gap-2 font-semibold text-heading">
        <Icon size={16} aria-hidden />
        {title}
      </span>
      <span className="text-xs text-muted">{description}</span>
    </button>
  );
}

export function ChannelSettingsModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const guildId = modal?.kind === 'channel-settings' ? modal.guildId : null;
  const channelId = modal?.kind === 'channel-settings' ? modal.channelId : null;
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const channel = guild?.channels.find((item) => item.id === channelId);
  const setChannelInGuild = useChatStore((state) => state.setChannelInGuild);
  const removeChannelFromGuild = useChatStore((state) => state.removeChannelFromGuild);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [userLimit, setUserLimit] = useState(0);
  const [access, setAccess] = useState<AccessDraft>({ visibility: 'public', roleIds: [] });
  // Allow/Deny per flag, applied to @everyone
  const [voiceAccess, setVoiceAccess] = useState({ connect: true, speak: true });
  const [loading, setLoading] = useState(false);

  const canManage = guild ? canInGuild(guild, Permission.ManageChannels) : false;

  useEffect(() => {
    if (!channel) return;
    setName(channel.name);
    setTopic(channel.topic ?? '');
    setUserLimit(channel.userLimit ?? 0);
    setAccess({ visibility: channel.private ? 'private' : 'public', roleIds: [] });
  }, [channel?.id]);

  useEffect(() => {
    if (!channel || channel.type !== 'voice') return;
    let cancelled = false;
    api.channels
      .overrides(channel.id)
      .then(({ overrides }) => {
        if (cancelled) return;
        const everyone = overrides.find((entry) => entry.roleId === '@everyone');
        setVoiceAccess({
          connect: !(everyone?.deny && (everyone.deny & Permission.Connect) === Permission.Connect),
          speak: !(everyone?.deny && (everyone.deny & Permission.Speak) === Permission.Speak),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channel?.id]);

  const save = async () => {
    if (!channel || !guildId) return;
    setLoading(true);
    try {
      if (channel.type === 'voice') {
        await api.channels.update(channel.id, {
          overrides: [voiceAccessOverride(voiceAccess.connect, voiceAccess.speak)],
        });
      }
      const { channel: updated } =
        channel.type === 'category'
          ? await api.guilds.updateCategory(guildId, channel.id, {
              name: name.trim() || channel.name,
              visibility: access.visibility,
              roleIds: access.roleIds,
            })
          : await api.channels.updateAccess(channel.id, {
              name: name.trim() || channel.name,
              topic: channel.type === 'text' ? topic.trim() || null : undefined,
              userLimit:
                channel.type === 'voice' ? Math.max(0, Math.min(99, Number.isFinite(userLimit) ? userLimit : 0)) : undefined,
              visibility: access.visibility,
              roleIds: access.roleIds,
            });
      setChannelInGuild(guildId, updated);
      close();
      toast.success(channel.type === 'category' ? 'Categoria atualizada' : 'Canal atualizado');
    } catch (error) {
      toast.error('Falha ao atualizar', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const remove = () => {
    if (!channel || !guildId) return;
    const isCategory = channel.type === 'category';
    openModal({
      kind: 'confirm',
      title: isCategory ? 'Excluir categoria' : 'Excluir canal',
      description: isCategory
        ? `Excluir "${channel.name}"? Os canais continuam existindo e vão para o topo da lista.`
        : `Deseja excluir #${channel.name}? Todas as mensagens serão removidas permanentemente.`,
      confirmLabel: isCategory ? 'Excluir categoria' : 'Excluir canal',
      onConfirm: async () => {
        if (isCategory) await api.guilds.removeCategory(guildId, channel.id);
        else await api.channels.remove(channel.id);
        removeChannelFromGuild(guildId, channel.id);
        if (!isCategory) navigate(`/app/${guildId}`);
      },
    });
  };

  const title =
    channel?.type === 'category' ? `Editar categoria ${channel.name}` : `Editar #${channel?.name ?? 'canal'}`;

  return (
    <Dialog open={modal?.kind === 'channel-settings'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        size="lg"
        title={title}
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void save()}
            submitLabel="Salvar alterações"
            loading={loading}
            submitDisabled={!name.trim() || !canManage}
            leading={
              canManage ? (
                <button type="button" onClick={remove} className="text-sm font-medium text-red hover:underline">
                  {channel?.type === 'category' ? 'Excluir categoria' : 'Excluir canal'}
                </button>
              ) : undefined
            }
          />
        }
      >
        <div className="flex flex-col gap-5">
          <TextField label={channel?.type === 'category' ? 'Nome da categoria' : 'Nome do canal'} value={name} onChange={(event) => setName(event.target.value)} />

          {channel?.type === 'text' ? (
            <TextAreaField
              label="Tópico"
              rows={3}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              hint="Exibido no topo do canal."
            />
          ) : null}

          {channel?.type === 'voice' ? (
            <>
              <LabelledField
                label="Limite de usuários"
                htmlFor="voice-limit"
                hint="0 significa sem limite. Moderadores sempre podem entrar."
              >
                <input
                  id="voice-limit"
                  type="number"
                  min={0}
                  max={99}
                  value={userLimit}
                  onChange={(event) => setUserLimit(Number(event.target.value))}
                  className="h-9 w-28 rounded-md border border-divider bg-input-sunken px-2.5 text-sm text-normal outline-none focus:border-brand"
                />
              </LabelledField>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">Permissões de @everyone</span>
                {(
                  [
                    { key: 'connect' as const, label: 'Conectar', hint: 'Entrar na chamada deste canal.' },
                    { key: 'speak' as const, label: 'Falar', hint: 'Transmitir áudio neste canal.' },
                  ]
                ).map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4 rounded-md border border-divider px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-heading">{item.label}</div>
                      <p className="text-[12px] text-muted">{item.hint}</p>
                    </div>
                    <select
                      value={voiceAccess[item.key] ? 'allow' : 'deny'}
                      onChange={(event) =>
                        setVoiceAccess((current) => ({ ...current, [item.key]: event.target.value === 'allow' }))
                      }
                      aria-label={item.label}
                      className="h-8 rounded-md border border-divider bg-input-sunken px-2 text-[13px] text-normal outline-none"
                    >
                      <option value="allow">Permitir</option>
                      <option value="deny">Negar</option>
                    </select>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {channel && guildId ? (
            <ChannelAccessEditor
              channel={channel}
              guildId={guildId}
              roles={guild?.roles ?? []}
              value={access}
              onChange={setAccess}
              onSynced={(channels) => {
                for (const updated of channels) setChannelInGuild(guildId, updated);
              }}
              readOnly={!canManage}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The @everyone override that encodes the Connect/Speak switches of a voice channel. */
export function voiceAccessOverride(
  connect: boolean,
  speak: boolean,
): { roleId: string; allow: number; deny: number } {
  const deny = (connect ? 0 : Permission.Connect) | (speak ? 0 : Permission.Speak);
  const allow = (connect ? Permission.Connect : 0) | (speak ? Permission.Speak : 0);
  // saving "everything allowed" clears both masks; sending nothing leaves an old deny in place
  return { roleId: '@everyone', allow, deny };
}
