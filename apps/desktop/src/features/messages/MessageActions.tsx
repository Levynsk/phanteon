import { Permission, type Message } from '@phanteon/shared';
import { Copy, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuthStore } from '../../app/stores/auth';
import { canInChannel, guildOfChannel, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { toast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

interface MessageActionsProps {
  message: Message;
  own: boolean;
  onEdit: () => void;
}

export interface MessageActionItem {
  key: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  run: () => void;
}

/** Everything a message can be acted on with, shared by the hover toolbar and the right-click menu. */
export function useMessageActions(message: Message, own: boolean, onEdit: () => void): MessageActionItem[] {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const canModerate = useChatStore((state) => canInChannel(state, message.channelId, Permission.ManageMessages));
  const canEditOwn = useChatStore((state) => canInChannel(state, message.channelId, Permission.ManageOwnMessages));
  const canReact = useChatStore((state) => canInChannel(state, message.channelId, Permission.AddReactions));

  // moderators can only delete messages from members ranked below them
  const outranksAuthor = useChatStore((state) => {
    const guild = guildOfChannel(state, message.channelId);
    if (!guild || !currentUserId) return false;
    if (guild.isOwner) return true;
    const mine = guild.members.find((member) => member.user.id === currentUserId)?.position ?? 0;
    const theirs = guild.members.find((member) => member.user.id === message.author.id)?.position ?? 0;
    return theirs < mine;
  });
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const openModal = useUiStore((state) => state.openModal);
  const startReply = useUiStore((state) => state.startReply);

  const items: MessageActionItem[] = [];
  if (canReact) {
    items.push({
      key: 'react',
      label: 'Adicionar reação',
      icon: <SmilePlus size={15} />,
      run: () => void toggleReaction(message.channelId, message.id, '👍'),
    });
  }
  items.push({
    key: 'reply',
    label: 'Responder',
    icon: <Reply size={14} />,
    run: () =>
      startReply({
        channelId: message.channelId,
        id: message.id,
        authorName: message.author.displayName,
        preview: message.content || (message.attachments.length > 0 ? 'Anexo' : ''),
      }),
  });
  if (message.content) {
    items.push({
      key: 'copy',
      label: 'Copiar texto',
      icon: <Copy size={14} />,
      run: () => {
        void navigator.clipboard
          .writeText(message.content)
          .then(() => toast.success('Texto copiado'))
          .catch(() => toast.error('Não foi possível copiar'));
      },
    });
  }
  if (own && canEditOwn) {
    items.push({ key: 'edit', label: 'Editar mensagem', icon: <Pencil size={14} />, run: onEdit });
  }
  if ((own && canEditOwn) || (canModerate && outranksAuthor)) {
    items.push({
      key: 'delete',
      label: 'Excluir mensagem',
      icon: <Trash2 size={14} />,
      danger: true,
      run: () =>
        openModal({
          kind: 'confirm',
          title: 'Excluir mensagem',
          description: 'Tem certeza que deseja excluir esta mensagem? Essa ação não pode ser desfeita.',
          confirmLabel: 'Excluir',
          onConfirm: async () => {
            await deleteMessage(message.channelId, message.id);
            toast.success('Mensagem excluída');
          },
        }),
    });
  }
  return items;
}

export function MessageActions({ message, own, onEdit }: MessageActionsProps) {
  const items = useMessageActions(message, own, onEdit);

  const actionClass =
    'flex size-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-heading';

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-divider bg-input p-0.5 shadow-elevated"
      role="toolbar"
      aria-label="Ações da mensagem"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-label={item.label}
          title={item.label}
          className={cn(actionClass, item.danger && 'hover:text-red')}
          onClick={item.run}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
