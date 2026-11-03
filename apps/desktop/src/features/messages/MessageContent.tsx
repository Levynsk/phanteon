import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { splitMentions, type MentionTarget } from '../../lib/mentions';
import { MentionChip } from './mentions/MentionName';

interface MessageContentProps {
  content: string;
  className?: string;
  /** People and channels of the guild, used to draw each `@name` and `#channel` as a chip. */
  targets?: MentionTarget[];
  /** Composer mirror: the text stays transparent and mentions are drawn over their own characters. */
  mirror?: boolean;
}

/**
 * One pass over the text. Each alternative is tried once per position and the
 * matched token is emitted as a leaf node, so relative emphasis like `*a *b* c*`
 * can never re-tokenise its own output.
 */
const TOKEN_PATTERN =
  /(https?:\/\/[^\s<]+)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(__[^_\n]+__)|(~~[^~\n]+~~)/g;

interface InlineOptions {
  targets: MentionTarget[];
  mirror: boolean;
}

function renderInline(text: string, keyPrefix: string, options: InlineOptions): ReactNode[] {
  const { targets, mirror } = options;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_PATTERN.lastIndex = 0;

  const pushMentions = (plain: string) => {
    splitMentions(plain, targets).forEach((token, index) => {
      if (token.type === 'text') {
        // in the mirror the text is invisible but keeps its width, so the caret lines up
        if (token.value) nodes.push(mirror ? <span key={`${keyPrefix}-${lastIndex}-t${index}`} className="text-transparent">{token.value}</span> : token.value);
      } else {
        nodes.push(
          <MentionChip
            key={`${keyPrefix}-${lastIndex}-m${index}`}
            name={token.name}
            targets={targets}
            mirror={mirror}
          />,
        );
      }
    });
  };

  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) pushMentions(text.slice(lastIndex, match.index));
    const [token, url, code, bold, italic, underline, strike] = match;
    const key = `${keyPrefix}-${match.index}`;
    // markdown styling on a transparent mirror would only change widths; keep it literal there
    const plain = (children: ReactNode) => (mirror ? <span key={key} className="text-transparent">{children}</span> : children);

    if (url) {
      nodes.push(
        mirror ? (
          <span key={key} className="text-transparent">
            {url}
          </span>
        ) : (
          <a key={key} href={url} target="_blank" rel="noreferrer" className="text-link [overflow-wrap:anywhere] hover:underline">
            {url}
          </a>
        ),
      );
    } else if (code) {
      // code is literal: an `@name` inside it must not become a chip
      nodes.push(plain(mirror ? code : <code className="rounded-sm bg-app px-1 py-px font-mono text-[13px]">{code.slice(1, -1)}</code>));
    } else if (bold) {
      nodes.push(plain(<strong>{bold.slice(2, -2)}</strong>));
    } else if (italic) {
      nodes.push(plain(<em>{italic.slice(1, -1)}</em>));
    } else if (underline) {
      nodes.push(plain(<u>{underline.slice(2, -2)}</u>));
    } else if (strike) {
      nodes.push(plain(<s>{strike.slice(2, -2)}</s>));
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) pushMentions(text.slice(lastIndex));
  return nodes;
}

/** Minimal Discord-flavoured markdown: links, mentions, code, bold, italic, underline, strike, quotes. */
export function MessageContent({ content, className, targets = [], mirror = false }: MessageContentProps) {
  const lines = content.split('\n');
  const options: InlineOptions = { targets, mirror };

  return (
    <div
      className={cn(
        'selectable min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-[15px] leading-[1.375rem] text-normal',
        mirror && 'text-transparent',
        className,
      )}
    >
      {lines.map((line, index) => {
        const isQuote = line.startsWith('> ');
        const body = isQuote ? line.slice(2) : line;
        const rendered = renderInline(body, `l${index}`, options);
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
