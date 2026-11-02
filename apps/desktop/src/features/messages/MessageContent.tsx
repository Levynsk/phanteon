import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface MessageContentProps {
  content: string;
  className?: string;
}

/**
 * One pass over the text. Each alternative is tried once per position and the
 * matched token is emitted as a leaf node, so relative emphasis like `*a *b* c*`
 * can never re-tokenise its own output.
 */
const TOKEN_PATTERN =
  /(https?:\/\/[^\s<]+)|(@[a-z0-9_.]+)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(__[^_\n]+__)|(~~[^~\n]+~~)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [token, url, mention, code, bold, italic, underline, strike] = match;
    const key = `${keyPrefix}-${match.index}`;

    if (url) {
      nodes.push(
        <a key={key} href={url} target="_blank" rel="noreferrer" className="text-link [overflow-wrap:anywhere] hover:underline">
          {url}
        </a>,
      );
    } else if (mention) {
      nodes.push(
        <span key={key} className="mention">
          {mention}
        </span>,
      );
    } else if (code) {
      nodes.push(
        <code key={key} className="rounded-sm bg-app px-1 py-px font-mono text-[13px]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key}>{italic.slice(1, -1)}</em>);
    } else if (underline) {
      nodes.push(<u key={key}>{underline.slice(2, -2)}</u>);
    } else if (strike) {
      nodes.push(<s key={key}>{strike.slice(2, -2)}</s>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** Minimal Discord-flavoured markdown: links, mentions, code, bold, italic, underline, strike, quotes. */
export function MessageContent({ content, className }: MessageContentProps) {
  const lines = content.split('\n');

  return (
    <div className={cn('selectable min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-[1.375rem] text-normal', className)}>
      {lines.map((line, index) => {
        const isQuote = line.startsWith('> ');
        const body = isQuote ? line.slice(2) : line;
        const rendered = renderInline(body, `l${index}`);
        return (
          <Fragment key={index}>
            {isQuote ? <span className="my-0.5 block border-l-4 border-muted pl-3">{rendered}</span> : rendered}
            {index < lines.length - 1 ? '\n' : null}
          </Fragment>
        );
      })}
    </div>
  );
}
