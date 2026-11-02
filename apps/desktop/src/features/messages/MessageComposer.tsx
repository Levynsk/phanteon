import type { Attachment } from '@phanteon/shared';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_PREFIXES,
  MAX_ARCHIVE_UPLOAD_BYTES,
  MAX_FILE_UPLOAD_BYTES,
  MAX_MESSAGE_ATTACHMENTS,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
} from '@phanteon/shared';
import { Lock, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Permission } from '@phanteon/shared';
import { canInChannel, guildOfChannel, useChatStore, type TypingEntry } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { cn } from '../../lib/cn';
import { realtime } from '../../lib/realtime';
import { IconButton } from '../../components/ui/IconButton';
import { AttachmentPreview } from './MessageAttachments';
import { toast } from '../../components/ui/Toast';
import { TypingIndicator } from '../presence/TypingIndicator';
import { ComposerReplyBar } from './ReplyPreview';

const EMPTY_TYPING: TypingEntry[] = [];

interface MessageComposerProps {
  channelId: string;
  placeholder?: string;
}

export function MessageComposer({ channelId, placeholder = 'Enviar mensagem…' }: MessageComposerProps) {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const canSendHere = useChatStore(
    (state) =>
      !guildOfChannel(state, channelId) || canInChannel(state, channelId, Permission.SendMessages),
  );
  const typing = useChatStore((state) => state.typing[channelId] ?? EMPTY_TYPING);
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const reply = useUiStore((state) => state.reply);
  const clearReply = useUiStore((state) => state.clearReply);
  const replyingTo = reply?.channelId === channelId ? reply : null;
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingAt = useRef(0);

  useEffect(() => {
    const handleQuote = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setValue((current) => `${current}${current ? '\n' : ''}${detail}`);
      textareaRef.current?.focus();
    };
    window.addEventListener('message:quote', handleQuote);
    return () => window.removeEventListener('message:quote', handleQuote);
  }, []);

  useEffect(() => {
    setValue('');
    setAttachments([]);
  }, [channelId]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [value]);

  const notifyTyping = () => {
    const now = Date.now();
    if (now - lastTypingAt.current > 3000) {
      lastTypingAt.current = now;
      realtime.startTyping(channelId);
    }
  };

  const addFiles = async (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    const room = MAX_MESSAGE_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error('Limite de anexos', `Uma mensagem aceita até ${MAX_MESSAGE_ATTACHMENTS} arquivos.`);
      return;
    }
    // validate everything before uploading so one bad file doesn't half-send a batch
    for (const file of list.slice(0, room)) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      const known =
        ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
        (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension);
      if (!known) {
        toast.error('Tipo de arquivo não permitido', file.name);
        return;
      }
      const limit = file.type.startsWith('video/')
        ? MAX_VIDEO_UPLOAD_BYTES
        : ['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)
          ? MAX_ARCHIVE_UPLOAD_BYTES
          : file.type.startsWith('image/') || file.type.startsWith('audio/')
            ? MAX_UPLOAD_BYTES
            : MAX_FILE_UPLOAD_BYTES;
      if (file.size > limit) {
        toast.error('Arquivo muito grande', `${file.name}: o limite é ${formatBytes(limit)}.`);
        return;
      }
    }
    if (list.length > room) {
      toast.error('Limite de anexos', `Uma mensagem aceita até ${MAX_MESSAGE_ATTACHMENTS} arquivos.`);
    }
    setUploading((count) => count + Math.min(list.length, room));
    for (const file of list.slice(0, room)) {
      try {
        const { attachment: uploaded } = await api.uploads.upload(file);
        setAttachments((current) => [...current, uploaded]);
      } catch (error) {
        toast.error('Falha no upload', error instanceof Error ? error.message : undefined);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const submit = async () => {
    const content = value.trim();
    if ((!content && attachments.length === 0) || sending || uploading > 0) return;
    setSending(true);
    try {
      await sendMessage(channelId, {
        content,
        attachmentIds: attachments.map((attachment) => attachment.id),
        replyToId: replyingTo?.id ?? null,
      });
      setValue('');
      setAttachments([]);
      if (replyingTo) clearReply();
    } catch (error) {
      toast.error('Não foi possível enviar', error instanceof Error ? error.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const isUploading = uploading > 0;
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isUploading && !sending && canSendHere;
  const remaining = MAX_MESSAGE_LENGTH - value.length;

  if (!canSendHere) {
    return (
      <div className="shrink-0 px-4 pb-6 pt-1">
        <div className="flex items-center justify-center gap-2 rounded-lg border border-divider bg-input px-4 py-3 text-sm text-muted">
          <Lock size={14} aria-hidden />
          Você não tem permissão para enviar mensagens neste canal.
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pb-2 pt-1">
      <div className="pl-1">
        <TypingIndicator entries={typing} />
      </div>

      <div
        className="flex flex-col rounded-xl border border-line bg-input focus-within:border-line-strong"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addFiles(event.dataTransfer.files);
        }}
      >
        {replyingTo ? (
          <ComposerReplyBar authorName={replyingTo.authorName} content={replyingTo.preview} onCancel={clearReply} />
        ) : null}

        {attachments.length > 0 || isUploading ? (
          <div className="flex flex-wrap items-start gap-2 border-b border-divider px-3 py-2">
            {attachments.map((attachment) => (
              <figure key={attachment.id} className="group/att relative size-20 overflow-hidden rounded-md border border-divider">
                <AttachmentPreview attachment={attachment} />
                <button
                  type="button"
                  aria-label={`Remover ${attachment.filename}`}
                  title={`${attachment.filename} · ${formatBytes(attachment.size)}`}
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-app/80 text-muted opacity-0 transition-opacity hover:text-heading focus-visible:opacity-100 group-hover/att:opacity-100"
                >
                  <X size={12} aria-hidden />
                </button>
              </figure>
            ))}
            {Array.from({ length: uploading }).map((_, index) => (
              <div
                key={`uploading-${index}`}
                className="flex size-20 items-center justify-center rounded-md border border-dashed border-divider text-[11px] text-muted"
              >
                Enviando…
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-1 px-2 py-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.zip,.rar,.7z,.tar,.gz,.txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <IconButton
            icon={Paperclip}
            label="Anexar arquivo"
            className="mb-1"
            disabled={isUploading || attachments.length >= MAX_MESSAGE_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-describedby={replyingTo ? 'reply-target' : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              notifyTyping();
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            className="max-h-[200px] min-h-[38px] flex-1 resize-none bg-transparent px-1 py-[9px] text-[15px] leading-[1.375rem] text-normal outline-none placeholder:text-faint"
          />
          <button
            type="button"
            aria-label="Enviar mensagem"
            disabled={!canSend}
            onClick={() => void submit()}
            className={cn(
              'mb-1 flex size-8 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-40',
              canSend ? 'text-brand hover:bg-hover' : 'text-muted',
            )}
          >
            <SendHorizontal size={18} aria-hidden />
          </button>
        </div>
      </div>

      {remaining < 200 ? (
        <div className="mt-1 px-1 text-right text-[11px] tabular-nums text-faint" aria-live="polite">
          {remaining}
        </div>
      ) : null}
    </div>
  );
}
