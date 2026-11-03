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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Permission } from '@phanteon/shared';
import { canInChannel, guildOfChannel, useChatStore, type TypingEntry } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import {
  activeMention,
  applyMention,
  codeUnits,
  mentionToken,
  textTargets,
  textWithoutMentions,
  type MentionSpan,
  type MentionTarget,
} from '../../lib/mentions';
import { useMentionSuggestions } from './mentions/MentionName';
import { MentionList } from './mentions/MentionList';
import { MessageContent } from './MessageContent';
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

  // plain-text `@name` ranges that were just picked; each behaves as one unit so the
  // finished mention never reads back as "still being typed"
  const [mentions, setMentions] = useState<MentionSpan[]>([]);
  // where the caret is, so the `@`/`#` being typed is known even before a keystroke arrives
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const guildId = useChatStore((state) => guildOfChannel(state, channelId)?.id ?? null);
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const mentionQuery = activeMention(value, caret, { atoms: mentions.map((span) => span.token) });
  // Escape hides the list until the trigger changes; typing a new `@` opens it again
  const listOpen = !!mentionQuery && dismissedAt !== mentionQuery.start;
  const suggestions = useMentionSuggestions(listOpen ? guildId : null, mentionQuery);
  const online = useChatStore((state) => state.online);
  const presence = useChatStore((state) => state.presence);
  const chips = useMemo(() => textTargets(guild, mentions.map((span) => span.token)), [guild, mentions]);
  // the mirror shows the text without the picked tokens, which are drawn as chips beside it
  const mirrorText = useMemo(() => textWithoutMentions(value, mentions.map((span) => span.token)), [value, mentions]);
  // the input re-renders with the finished mention highlighted, like the message it will become
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMentionActive(0);
  }, [mentionQuery?.start, mentionQuery?.kind, mentionQuery?.query]);

  // the caret may not land inside a mention: it is one word, edited only whole
  const snapCaret = useCallback(
    (position: number, direction: 'forward' | 'backward') => {
      const at = mentions.findIndex((span) => position > span.start && position < span.start + span.length);
      if (at < 0) return position;
      return direction === 'forward' ? mentions[at]!.start + mentions[at]!.length : mentions[at]!.start;
    },
    [mentions],
  );

  const placeCaret = useCallback(
    (position: number) => {
      const element = textareaRef.current;
      if (!element) return;
      element.setSelectionRange(position, position);
      setCaret(position);
      if (backdropRef.current) backdropRef.current.scrollTop = element.scrollTop;
    },
    [],
  );

  const pickMention = (target: MentionTarget) => {
    if (!mentionQuery) return;
    const next = applyMention(value, mentionQuery, target);
    const span: MentionSpan = { start: mentionQuery.start, token: mentionToken(target), length: mentionToken(target).length };
    const shift = span.length - (mentionQuery.end - mentionQuery.start);
    setValue(next.text);
    setMentions((current) => [
      ...current.map((other) => (other.start >= mentionQuery.end ? { ...other, start: other.start + shift } : other)),
      span,
    ]);
    setCaret(next.caret);
    // picking finishes the mention: the list closes until a new trigger is typed
    setDismissedAt(next.caret);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      placeCaret(next.caret);
    });
  };

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
    setMentions([]);
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
      setMentions([]);
      if (replyingTo) clearReply();
    } catch (error) {
      toast.error('Não foi possível enviar', error instanceof Error ? error.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const isUploading = uploading > 0;
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isUploading && !sending && canSendHere;
  // the same unit the server counts in (UTF-16), so the number matches what it will accept
  const length = codeUnits(value);
  const remaining = MAX_MESSAGE_LENGTH - length;

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
          {/*
            Mirror of the textarea: same box, same font metrics, the text transparent. Dropping the
            mention tokens leaves every other character at the top-left corner of the input, so the
            typed text and the mention chip never share space or drift.
          */}
          <div className="relative min-h-[38px] flex-1">
            {listOpen ? (
              <MentionList
                targets={suggestions}
                query={mentionQuery?.query ?? ''}
                active={mentionActive}
                onHover={setMentionActive}
                onPick={pickMention}
                onlineOf={(userId) => online[userId] ?? false}
                statusOf={(userId) => presence[userId] ?? 'online'}
              />
            ) : null}
            <div ref={backdropRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="min-h-[38px] w-full whitespace-pre-wrap break-words px-1 py-[9px] text-[15px] leading-[1.375rem] text-normal [overflow-wrap:anywhere]">
                {chips.length > 0 ? <MessageContent content={mirrorText} targets={chips} mirror /> : mirrorText}
                {'\u200b'}
              </div>
            </div>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            maxLength={MAX_MESSAGE_LENGTH}
            spellCheck={false}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-describedby={replyingTo ? 'reply-target' : undefined}
            onChange={(event) => {
              const next = event.target.value;
              const element = event.currentTarget;
              // after one keystroke the caret before it sits on the same text as the new one
              const editedAt = Math.min(caret, element.selectionStart ?? next.length);
              setMentions((current) =>
                current.flatMap((span) => {
                  const end = span.start + span.length;
                  const intact = next.slice(span.start, end) === span.token;
                  // typing or deleting right at either edge edits the mention, so it stops being one
                  if (!intact || (editedAt > span.start && editedAt < end)) return [];
                  return [span];
                }),
              );
              setValue(next);
              setCaret(element.selectionStart ?? next.length);
              notifyTyping();
            }}
            // the caret can move without any typing (clicks, arrows, home/end)
            onSelect={(event) => {
              const element = event.currentTarget;
              const position = element.selectionStart ?? 0;
              if (element.selectionStart !== element.selectionEnd) {
                setCaret(position);
                return;
              }
              const snapped = snapCaret(position, position > caret ? 'forward' : 'backward');
              if (snapped !== position) {
                placeCaret(snapped);
                return;
              }
              setCaret(position);
            }}
            onScroll={(event) => {
              if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onBlur={() => setCaret(0)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (listOpen) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const count = suggestions.length;
                  if (count === 0) return;
                  setMentionActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
                  return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                  const target = suggestions[mentionActive];
                  if (target) {
                    event.preventDefault();
                    pickMention(target);
                    return;
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  // only the list closes; the typed `@` stays in the message
                  setDismissedAt(mentionQuery?.start ?? null);
                  return;
                }
              }
              const element = event.currentTarget;
              const position = element.selectionStart ?? 0;
              if (event.key === 'Backspace' || event.key === 'Delete') {
                const span = mentions.find(
                  (candidate) =>
                    (event.key === 'Backspace' && position <= candidate.start + candidate.length && position > candidate.start) ||
                    (event.key === 'Delete' && position >= candidate.start && position < candidate.start + candidate.length),
                );
                if (span) {
                  // a mention is one word: deleting it never leaves half an `@name` behind
                  event.preventDefault();
                  setValue(value.slice(0, span.start) + value.slice(span.start + span.length));
                  setMentions((current) => current.filter((other) => other !== span));
                  placeCaret(span.start);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            // transparent: the mirror behind paints the text, raw value included, at the same place
            className="relative block max-h-[200px] min-h-[38px] w-full flex-1 resize-none bg-transparent px-1 py-[9px] text-[15px] leading-[1.375rem] text-transparent caret-heading outline-none selection:bg-brand/35 placeholder:text-faint"
          />
          </div>
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
