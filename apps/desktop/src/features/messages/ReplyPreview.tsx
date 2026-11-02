import { CornerDownRight, X } from 'lucide-react';
import type { Message } from '@phanteon/shared';
import { cn } from '../../lib/cn';

/** Preview line used when composing a reply. */
export function ComposerReplyBar({
  authorName,
  content,
  onCancel,
}: {
  authorName: string;
  content: string;
  onCancel: () => void;
}) {
  return (
    <div id="reply-target" className="flex items-center gap-2 border-b border-divider px-3 py-1.5 text-[13px]">
      <span className="shrink-0 font-semibold text-normal">Respondendo a {authorName}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{content || 'Anexo'}</span>
      <button
        type="button"
        aria-label="Cancelar resposta"
        className="shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-hover hover:text-heading"
        onClick={onCancel}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Quote shown above a message that was sent as a reply. Clicking it jumps to
 * the original when that message is on screen.
 */
export function ReplyQuote({
  reply,
  onClick,
}: {
  reply: NonNullable<Message['replyTo']>;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/reply mb-0.5 flex max-w-full items-center gap-1.5 pl-0.5 text-left text-[13px] leading-5',
        onClick ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <CornerDownRight size={12} className="shrink-0 text-faint" aria-hidden />
      <span className="shrink-0 font-semibold text-normal">{reply.author.displayName}</span>
      <span className="min-w-0 truncate text-muted">
        {reply.content || (reply.hasAttachments ? 'Clique para ver o anexo' : 'Mensagem')}
      </span>
    </button>
  );
}
