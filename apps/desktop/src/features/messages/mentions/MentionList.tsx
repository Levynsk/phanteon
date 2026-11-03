import { useEffect, useRef, useState } from 'react';
import type { UserStatus } from '@phanteon/shared';
import type { MentionTarget } from '../../../lib/mentions';
import { Avatar } from '../../../components/ui/Avatar';
import { STATUS_SHORT } from '../../../components/ui/Status';
import { cn } from '../../../lib/cn';
import { ChannelIcon, HighlightedName } from './MentionName';

/**
 * The list that opens while `@` or `#` is typed above the composer. The
 * composer owns the keyboard (arrows, Enter, Tab, Escape); picking a row is
 * delegated so the composer replaces the typed query by itself.
 */
export function MentionList({
  targets,
  query,
  active,
  onHover,
  onPick,
  onlineOf,
  statusOf,
}: {
  targets: MentionTarget[];
  query: string;
  active: number;
  onHover: (index: number) => void;
  onPick: (target: MentionTarget) => void;
  onlineOf: (userId: string) => boolean;
  statusOf: (userId: string) => UserStatus;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, targets.length]);

  if (targets.length === 0) {
    return (
      <div role="status" className="absolute inset-x-0 bottom-full z-40 mb-2 rounded-lg border border-divider bg-elevated p-3 text-sm text-muted shadow-popover">
        Ninguém ou nenhum canal com esse nome.
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Sugestões de menção"
      // anchored to the input box itself, centred on it, rather than the whole composer row
      className="absolute bottom-full left-0 z-40 mb-2 flex max-h-64 min-w-[18rem] max-w-[min(28rem,calc(100vw-4rem))] flex-col overflow-y-auto rounded-lg border border-divider bg-elevated py-1 shadow-popover [scrollbar-width:thin]"
    >
      {targets.map((target, index) => {
        const selected = index === active;
        const online = target.kind === 'user' && onlineOf(target.id);
        return (
          <li key={`${target.kind}:${target.id}`} role="none">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              // pointer events would steal focus from the composer
              onMouseDown={(event) => {
                // the composer must keep focus and its caret, so the row acts on press
                event.preventDefault();
                onPick(target);
              }}
              onMouseEnter={() => onHover(index)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] transition-colors',
                selected ? 'bg-hover text-heading' : 'text-normal',
              )}
            >
              {target.user ? (
                <Avatar
                  name={target.user.displayName}
                  src={target.user.avatarUrl}
                  color={target.user.accentColor}
                  size="xs"
                  className={cn('size-6', !online && 'opacity-50')}
                />
              ) : (
                <ChannelIcon voice={target.channel} size={16} />
              )}
              <span className="min-w-0 flex-1 truncate">
                <HighlightedName name={target.name} query={query} />
              </span>
              <span className="shrink-0 text-[11px] text-faint">
                {target.kind === 'user' ? (online ? STATUS_SHORT[statusOf(target.id)] : STATUS_SHORT.offline) : target.channel ? 'Voz' : 'Texto'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
