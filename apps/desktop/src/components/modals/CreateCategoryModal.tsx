import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { Dialog, DialogContent } from '../ui/Dialog';
import { CheckboxRow } from '../ui/Checkbox';
import { TextField } from '../ui/Field';
import { toast } from '../ui/Toast';
import { DialogActions } from './DialogActions';

export function CreateCategoryModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const guildId = modal?.kind === 'create-category' ? modal.guildId : null;
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const setChannelInGuild = useChatStore((state) => state.setChannelInGuild);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [withChannel, setWithChannel] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modal?.kind === 'create-category') {
      setName('');
      setWithChannel(true);
    }
  }, [modal]);

  const submit = async () => {
    if (!guildId || !name.trim()) return;
    setLoading(true);
    try {
      const { channel } = await api.guilds.createCategory(guildId, { name: name.trim() });
      setChannelInGuild(guildId, channel);
      close();
      toast.success(`Categoria ${channel.name} criada`);
      if (withChannel) {
        openModal({ kind: 'create-channel', guildId, type: 'text', categoryId: channel.id });
        return;
      }
      navigate(`/app/${guildId}`);
    } catch (error) {
      toast.error('Falha ao criar categoria', error instanceof Error ? error.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={modal?.kind === 'create-category'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        title="Criar categoria"
        footer={
          <DialogActions
            onCancel={close}
            onSubmit={() => void submit()}
            submitLabel="Criar categoria"
            loading={loading}
            submitDisabled={!name.trim()}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label="Nome da categoria"
            autoFocus
            placeholder="Projetos, Staff, Arquivo…"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            hint="Depois você define se ela é privada e quais cargos podem vê-la."
          />
          <CheckboxRow checked={withChannel} onChange={(event) => setWithChannel(event.target.checked)}>
            Criar um canal de texto dentro dela
          </CheckboxRow>
          {guild ? (
            <p className="text-[12px] text-muted">
              No servidor <span className="font-semibold text-normal">{guild.name}</span>. Categorias agrupam canais na
              barra lateral.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
