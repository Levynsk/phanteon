import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Link2, Trash2 } from 'lucide-react';
import { MAX_GUILD_NAME_LENGTH, type GuildInvite } from '@phanteon/shared';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Dialog, DialogContent } from '../ui/Dialog';
import { TextField } from '../ui/Field';
import { IconButton } from '../ui/IconButton';
import { cn } from '../../lib/cn';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';

export function CreateServerModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const addGuild = useChatStore((state) => state.addGuild);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const open = modal?.kind === 'create-server';

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const submit = async () => {
    setLoading(true);
    try {
      const { guild } = await api.guilds.create({ name: name.trim() });
      addGuild(guild);
      close();
      const firstChannel = guild.channels.find((channel) => channel.type === 'text');
      navigate(firstChannel ? `/app/${guild.id}/${firstChannel.id}` : `/app/${guild.id}`);
      toast.success(`Servidor "${guild.name}" criado!`);
    } catch (error) {
      toast.error('Não foi possível criar o servidor', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Personalize seu servidor"
        description="Dê um nome para o seu novo servidor. Você pode mudar depois."
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void submit()}
            submitLabel="Criar servidor"
            loading={loading}
            submitDisabled={!name.trim()}
          />
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField
            label="Nome do servidor"
            autoFocus
            maxLength={MAX_GUILD_NAME_LENGTH}
            placeholder="ex.: Clube dos Devs"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function JoinServerModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const addGuild = useChatStore((state) => state.addGuild);
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const open = modal?.kind === 'join-server';

  useEffect(() => {
    if (open) setCode('');
  }, [open]);

  const submit = async () => {
    setLoading(true);
    try {
      const { guild } = await api.guilds.join(code.trim());
      addGuild(guild);
      close();
      const firstChannel = guild.channels.find((channel) => channel.type === 'text');
      navigate(firstChannel ? `/app/${guild.id}/${firstChannel.id}` : `/app/${guild.id}`);
      toast.success(`Bem-vindo(a) a ${guild.name}!`);
    } catch (error) {
      toast.error('Convite inválido', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Entrar em um servidor"
        description="Digite um código de convite abaixo para entrar em um servidor existente."
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void submit()}
            submitLabel="Entrar"
            loading={loading}
            submitDisabled={!code.trim()}
          />
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <TextField
            label="Código do convite"
            autoFocus
            placeholder="ex.: d2aumdfq"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

const HOUR = 60 * 60 * 1000;

const EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Nunca', value: null },
  { label: '30 min', value: 30 * 60 * 1000 },
  { label: '1 hora', value: HOUR },
  { label: '6 horas', value: 6 * HOUR },
  { label: '12 horas', value: 12 * HOUR },
  { label: '1 dia', value: 24 * HOUR },
  { label: '7 dias', value: 7 * 24 * HOUR },
];

const USES_OPTIONS: { label: string; value: number }[] = [
  { label: 'Ilimitado', value: 0 },
  { label: '1 uso', value: 1 },
  { label: '5 usos', value: 5 },
  { label: '10 usos', value: 10 },
  { label: '25 usos', value: 25 },
];

const SELECT_CLASS =
  'h-9 w-full rounded-sm border border-divider bg-app px-2 text-sm text-normal outline-none focus-visible:ring-2 focus-visible:ring-brand';

function describeInvite(invite: GuildInvite): string {
  const uses = invite.maxUses > 0 ? `${invite.uses}/${invite.maxUses} usos` : `∞ usos`;
  if (!invite.expiresAt) return uses;
  const expires = new Date(invite.expiresAt);
  if (expires.getTime() <= Date.now()) return `${uses} · expirou`;
  return `${uses} · expira ${expires.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`;
}

export function InviteModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const guildId = modal?.kind === 'invite' ? modal.guildId : null;
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const [invites, setInvites] = useState<GuildInvite[]>([]);
  const [latest, setLatest] = useState<GuildInvite | null>(null);
  const [maxUses, setMaxUses] = useState(0);
  const [duration, setDuration] = useState<number | null>(7 * 24 * HOUR);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      const { invites: list } = await api.guilds.listInvites(guildId);
      setInvites(list);
    } catch (error) {
      toast.error('Não foi possível carregar os convites', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => {
    if (!modal || modal.kind !== 'invite') return;
    setLatest(null);
    void load();
  }, [modal, load]);

  // active invites float to the top; exhausted ones stay visible but struck through
  const activeInvites = invites.filter((invite) => invite.active);
  const sortedInvites = [...invites].sort((a, b) => Number(b.active) - Number(a.active));

  const generate = async () => {
    if (!guildId) return;
    setGenerating(true);
    try {
      const { invite } = await api.guilds.createInvite(guildId, { maxUses, durationMs: duration });
      setLatest(invite);
      await navigator.clipboard.writeText(invite.code).catch(() => undefined);
      toast.success('Convite criado e copiado', invite.code);
      await load();
    } catch (error) {
      toast.error('Não foi possível gerar o convite', error instanceof Error ? error.message : undefined);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Convite copiado!');
    } catch {
      toast.error('Não foi possível copiar', 'Copie o código manualmente.');
    }
  };

  const revoke = async (code: string) => {
    try {
      await api.guilds.revokeInvite(code);
      setInvites((current) => current.filter((invite) => invite.code !== code));
      setLatest((current) => (current?.code === code ? null : current));
      toast.success('Convite revogado');
    } catch (error) {
      toast.error('Falha ao revogar convite', error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <Dialog open={modal?.kind === 'invite'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        size="md"
        title={`Convide pessoas para ${guild?.name ?? 'seu servidor'}`}
        description="Crie um link com limite de usos e prazo de validade, ou compartilhe os convites existentes."
        fixedBody
        footer={
          <Button variant="primary" onClick={() => void generate()} loading={generating}>
            <Link2 size={15} aria-hidden /> Gerar convite
          </Button>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              Expira em
              <select
                className={SELECT_CLASS}
                value={duration === null ? 'never' : String(duration)}
                onChange={(event) =>
                  setDuration(event.target.value === 'never' ? null : Number(event.target.value))
                }
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value === null ? 'never' : option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              Usos máximos
              <select
                className={SELECT_CLASS}
                value={maxUses}
                onChange={(event) => setMaxUses(Number(event.target.value))}
              >
                {USES_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {latest ? (
            <div className="flex shrink-0 items-center justify-between gap-3 rounded-sm border border-brand/40 bg-brand/10 px-4 py-2.5">
              <div className="min-w-0">
                <span className="selectable block truncate font-mono text-base tracking-[0.25em] text-heading">{latest.code}</span>
                <span className="block truncate text-[11px] text-muted">{describeInvite(latest)}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void copy(latest.code)}>
                <Copy size={14} aria-hidden /> Copiar
              </Button>
            </div>
          ) : null}

          <Tabs defaultValue="all" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="-mx-6 px-6">
              <TabsTrigger value="all">
                Convites
                <span className="rounded-full bg-tint-strong px-1.5 text-[11px] text-muted">{invites.length}</span>
              </TabsTrigger>
              <TabsTrigger value="active">
                Ativos
                <span className="rounded-full bg-tint-strong px-1.5 text-[11px] text-muted">{activeInvites.length}</span>
              </TabsTrigger>
            </TabsList>
            {(['all', 'active'] as const).map((tab) => {
              const list = tab === 'all' ? sortedInvites : activeInvites;
              return (
                <TabsContent key={tab} value={tab} className="pt-3">
                  {list.length === 0 ? (
                    <p className="rounded-sm border border-dashed border-divider px-3 py-8 text-center text-sm text-muted">
                      {loading
                        ? 'Carregando convites…'
                        : tab === 'active'
                          ? 'Nenhum convite ativo. Gere um novo acima.'
                          : 'Nenhum convite ainda. Gere o primeiro acima.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-divider rounded-md border border-divider bg-input">
                      {list.map((invite) => (
                        <li key={invite.code} className="flex items-center gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className={cn('block font-mono text-sm tracking-widest', invite.active ? 'text-heading' : 'text-faint line-through')}>
                              {invite.code}
                            </span>
                            <span className="block truncate text-[11px] text-muted">
                              {invite.inviter ? `por ${invite.inviter.displayName} · ` : ''}
                              {describeInvite(invite)}
                            </span>
                          </div>
                          <IconButton icon={Copy} size={14} label={`Copiar convite ${invite.code}`} onClick={() => void copy(invite.code)} />
                          <IconButton
                            icon={Trash2}
                            size={14}
                            label={`Revogar convite ${invite.code}`}
                            className="hover:bg-red/15 hover:text-red"
                            onClick={() => void revoke(invite.code)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
