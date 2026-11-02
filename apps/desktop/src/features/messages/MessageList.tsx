import type { Message } from '@phanteon/shared';
import { QUICK_EMOJIS } from '@phanteon/shared';
import { ImageIcon, Link2, MessageCircle, Quote as QuoteIcon, SmilePlus } from 'lucide-react';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../app/stores/auth';
import { Permission } from '@phanteon/shared';
import { canInChannel, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { MemberName } from '../../components/ui/MemberName';
import {
  formatBytes,
  formatDateSeparator,
  formatMessageTimestamp,
  formatTime,
  GROUP_WINDOW_MS,
  isSameDay,
} from '../../lib/format';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { MessageActions, useMessageActions } from './MessageActions';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../../components/ui/ContextMenu';
import { ReplyQuote } from './ReplyPreview';
import { MessageComposer } from './MessageComposer';
import { MessageContent } from './MessageContent';
import { MessageAttachments } from './MessageAttachments';
import { extractLinks, LinkEmbeds } from './LinkEmbeds';

interface MessageListProps {
  channelId: string;
  guildId?: string;
  isDm?: boolean;
}

export function MessageList({ channelId, guildId, isDm }: MessageListProps) {
  const messages = useChatStore((state) => state.messages[channelId]?.items ?? EMPTY_MESSAGES);
  const hasMore = useChatStore((state) => state.messages[channelId]?.hasMore ?? false);
  const loaded = useChatStore((state) => state.messages[channelId]?.loaded ?? false);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const currentUser = useAuthStore((state) => state.user);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const jumpToMessage = useCallback((messageId: string) => {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedId(messageId);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 1500);
  }, []);

  // the viewport no longer starts at the bottom, so jump to the newest message once
  const scrolledRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollToNewest = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !loaded || scrolledRef.current === channelId) return;
      scrolledRef.current = channelId;
      node.scrollTop = node.scrollHeight;
    },
    [channelId, loaded],
  );

  const grouped = useMemo(
    () =>
      messages.map((message, index) => {
        const previous = messages[index - 1];
        const showDate = !previous || !isSameDay(previous.createdAt, message.createdAt);
        const continues =
          !!previous &&
          !message.replyTo &&
          previous.author.id === message.author.id &&
          !showDate &&
          new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS;
        return { message, showDate, continues };
      }),
    [messages],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-chat">
      <ScrollArea
        className="flex-1"
        viewportClassName="px-4"
        viewportRef={viewportRef}
        viewportInnerRef={scrollToNewest}
      >
        <div className="flex min-w-0 flex-col pb-2" role="log" aria-live="polite" aria-label="Mensagens">
          {hasMore ? (
            <button
              type="button"
              className="mx-auto mb-2 mt-3 rounded-sm bg-input px-3 py-1 text-xs text-muted hover:text-normal"
              onClick={() => void loadMessages(channelId, { before: messages[0]?.id })}
            >
              Carregar mensagens anteriores
            </button>
          ) : null}

          {!loaded ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted">Carregando mensagens…</div>
          ) : (
            <>
              <ChannelIntro isDm={!!isDm} />
              {grouped.map(({ message, showDate, continues }) => (
                <Fragment key={message.id}>
                  {showDate ? <DateSeparator iso={message.createdAt} /> : null}
                  <MessageItem
                    message={message}
                    continues={continues}
                    highlighted={highlightedId === message.id}
                    onJumpToReply={jumpToMessage}
                    guildId={isDm ? undefined : guildId}
                    own={message.author.id === currentUser?.id}
                    editing={editingId === message.id}
                    onStartEdit={() => setEditingId(message.id)}
                    onStopEdit={() => setEditingId(null)}
                  />
                </Fragment>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
      <MessageComposer channelId={channelId} />
    </div>
  );
}

const EMPTY_MESSAGES: Message[] = [];

interface MessageItemProps {
  message: Message;
  continues: boolean;
  own: boolean;
  editing: boolean;
  highlighted?: boolean;
  guildId?: string;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onJumpToReply?: (messageId: string) => void;
}

export function MessageItem({
  message,
  continues,
  own,
  editing,
  highlighted,
  guildId,
  onStartEdit,
  onStopEdit,
  onJumpToReply,
}: MessageItemProps) {
  const toggleReaction = useChatStore((state) => state.toggleReaction);
  const canReact = useChatStore((state) => canInChannel(state, message.channelId, Permission.AddReactions));
  const openUserProfile = useUiStore((state) => state.openUserProfile);
  const actions = useMessageActions(message, own, onStartEdit);

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <article
      id={`message-${message.id}`}
      className={cn(
        'group relative flex gap-4 px-4 py-0.5 transition-colors hover:bg-hover',
        continues ? 'mt-0' : 'mt-[17px]',
        highlighted && 'bg-brand-soft',
      )}
      aria-label={`Mensagem de ${message.author.displayName}`}
    >
      <div className="w-10 shrink-0">
        {continues ? (
          // same box as the timestamp next to the author name on the first line, so the
          // text column never shifts and the hover timestamp lines up with the message
          <span className="flex h-[24px] items-center justify-end pr-1 text-[11px] leading-none text-faint opacity-0 group-hover:opacity-100">
            {formatTime(message.createdAt)}
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Ver perfil de ${message.author.displayName}`}
            onClick={(event) => openUserProfile(message.author.id, guildId, { x: event.clientX, y: event.clientY }, event.currentTarget)}
            className="rounded-full transition-transform hover:scale-105"
          >
            <Avatar name={message.author.displayName} src={message.author.avatarUrl} color={message.author.accentColor} size="md" />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.replyTo ? (
          <ReplyQuote reply={message.replyTo} onClick={() => onJumpToReply?.(message.replyTo!.id)} />
        ) : null}
        {!continues ? (
          <div className="flex items-baseline gap-2">
            <MemberName user={message.author} guildId={guildId} className="text-[15px]" clickable />
            <time dateTime={message.createdAt} className="text-[11px] text-faint">
              {formatMessageTimestamp(message.createdAt)}
            </time>
          </div>
        ) : null}

        {editing ? (
          <MessageEditForm message={message} onCancel={onStopEdit} onSaved={onStopEdit} />
        ) : (
          <>
            {message.content ? <MessageContent content={message.content} className="text-[15px] leading-[1.375rem]" /> : null}
            {message.content ? <MessageEmbeds content={message.content} /> : null}
            {message.editedAt ? <span className="ml-1 text-[10px] text-faint">(editado)</span> : null}
            {message.attachments.length > 0 ? <MessageAttachments attachments={message.attachments} /> : null}
            {message.reactions.length > 0 ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {message.reactions.map((reaction) => (
                  <button
                    key={reaction.emoji}
                    type="button"
                    aria-pressed={reaction.me}
                    aria-label={`${reaction.emoji}, ${reaction.count} reações`}
                    disabled={!canReact}
                    onClick={() => void toggleReaction(message.channelId, message.id, reaction.emoji)}
                    className={cn(
                      'flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] transition-colors',
                      reaction.me
                        ? 'border-brand bg-brand-soft text-brand'
                        : 'border-divider text-normal hover:border-muted',
                    )}
                  >
                    <span>{reaction.emoji}</span>
                    <span className="font-semibold">{reaction.count}</span>
                  </button>
                ))}
                {canReact ? <ReactionPicker message={message} /> : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {!editing ? (
        <div className="absolute -top-3 right-4 opacity-0 transition-opacity [&:focus-within]:opacity-100 group-hover:opacity-100">
          <MessageActions message={message} own={own} onEdit={onStartEdit} />
        </div>
      ) : null}
    </article>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-[212px]">
      <ContextMenuItem icon={<QuoteIcon size={14} />} onSelect={actions.find((item) => item.key === 'reply')?.run}>
        Responder
      </ContextMenuItem>
      {actions.filter((item) => item.key !== 'reply').map((item) => (
        <ContextMenuItem
          key={item.key}
          icon={item.icon}
          variant={item.danger ? 'danger' : 'default'}
          onSelect={item.run}
        >
          {item.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<Link2 size={14} />}
        onSelect={() => {
          const url = `${window.location.origin}${window.location.pathname}#message-${message.id}`;
          void navigator.clipboard.writeText(url).catch(() => undefined);
        }}
      >
        Copiar link da mensagem
      </ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  );
}

function ReactionPicker({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const toggleReaction = useChatStore((state) => state.toggleReaction);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Adicionar reação"
          className="flex h-6 items-center rounded-md px-1.5 text-muted hover:bg-hover hover:text-heading"
        >
          <SmilePlus size={14} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex gap-1 p-1">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`Reagir com ${emoji}`}
            className="rounded-sm p-1 text-lg hover:bg-hover"
            onClick={() => {
              void toggleReaction(message.channelId, message.id, emoji);
              setOpen(false);
            }}
          >
            {emoji}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function MessageEditForm({ message, onCancel, onSaved }: { message: Message; onCancel: () => void; onSaved: () => void }) {
  const editMessage = useChatStore((state) => state.editMessage);
  const [value, setValue] = useState(message.content);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!value.trim() || value === message.content) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      await editMessage(message.id, value);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="mt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <textarea
        autoFocus
        value={value}
        disabled={saving}
        aria-label="Editar mensagem"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
          if (event.key === 'Escape') onCancel();
        }}
        rows={Math.min(6, Math.max(2, value.split('\n').length))}
        className="w-full resize-none rounded-sm border border-brand bg-input p-2 text-[15px] text-normal outline-none"
      />
      <p className="mt-1 text-[12px] text-muted">Enter para salvar · Esc para cancelar</p>
    </form>
  );
}

/** Link cards under the text. `extractLinks` is pure and bounded, so a render is cheap. */
function MessageEmbeds({ content }: { content: string }) {
  const urls = extractLinks(content);
  if (urls.length === 0) return null;
  return <LinkEmbeds urls={urls} />;
}

function DateSeparator({ iso }: { iso: string }) {
  return (
    <div className="relative mx-4 mt-4 flex items-center" role="separator" aria-label={formatDateSeparator(iso)}>
      <span className="h-px flex-1 bg-divider" />
      <span className="mx-2 text-[11px] font-semibold text-muted">{formatDateSeparator(iso)}</span>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}

function ChannelIntro({ isDm }: { isDm: boolean }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 pb-2 pt-8">
      <div className="flex size-16 items-center justify-center rounded-full bg-input text-heading">
        {isDm ? <MessageCircle size={30} aria-hidden /> : <ImageIcon size={30} aria-hidden />}
      </div>
      <h2 className="text-[32px] font-bold leading-tight text-heading">
        {isDm ? 'Início da conversa' : 'Bem-vindo(a)!'}
      </h2>
      <p className="max-w-xl text-[15px] text-muted">
        Este é o começo do canal. Envie uma mensagem, reaja ou anexe uma imagem para começar a conversa.
      </p>
    </div>
  );
}
