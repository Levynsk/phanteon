import type { LucideIcon } from 'lucide-react';
import { Hash, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { UserStatus } from '@phanteon/shared';
import { useChatStore } from '../../../app/stores/chat';
import { Avatar } from '../../../components/ui/Avatar';
import { cn } from '../../../lib/cn';
import { mentionSuggestions, type MentionTarget } from '../../../lib/mentions';

const MAX_SUGGESTIONS = 8;

/** People and channels of a guild, in the shape the mention helpers work with. */
export function useMentionTargets(guildId: string | null | undefined): MentionTarget[] {
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const members = useChatStore((state) => (guildId ? state.guildDetails[guildId]?.members : undefined));
  const channels = useChatStore((state) => (guildId ? state.guildDetails[guildId]?.channels : undefined));
  if (!guild) return [];
  return [
    ...(members ?? []).map((member) => ({
      kind: 'user' as const,
      id: member.user.id,
      name: member.user.displayName,
      user: member.user,
    })),
    ...(channels ?? []).map((channel) => ({
      kind: 'channel' as const,
      id: channel.id,
      name: channel.name,
      channel: channel.type === 'voice',
    })),
  ];
}

/** Suggestions for what is being typed after `@` or `#`, in the order the list shows them. */
export function useMentionSuggestions(
  guildId: string | null | undefined,
  query: { kind: 'user' | 'channel'; query: string } | null,
): MentionTarget[] {
  const targets = useMentionTargets(guildId);
  if (!query) return [];
  return mentionSuggestions(targets, { ...query, start: 0, end: 0 }, MAX_SUGGESTIONS);
}

/** Channel icon matching the sidebar: `#` for text, a speaker for voice. */
export function ChannelIcon({ voice, size = 14, className }: { voice?: boolean; size?: number; className?: string }) {
  const Icon: LucideIcon = voice ? Volume2 : Hash;
  return <Icon size={size} className={cn('shrink-0 text-muted', className)} aria-hidden />;
}

/**
 * A mention as it reads in a chat line: the person's picture in place of the
 * `@` and the name right after it. Names that no longer belong to anyone just
 * stay plain text, so a deleted member leaves readable history.
 */
export function MentionChip({
  name,
  targets,
  mirror = false,
  token,
}: {
  name: string;
  targets: MentionTarget[];
  /** Inside the composer's mirror the text must occupy exactly the characters it stands for. */
  mirror?: boolean;
  /** The stored text, e.g. `@Ana Lima`; rendered invisibly under the chip in the mirror. */
  token?: string;
}) {
  const user = targets.find((target) => target.kind === 'user' && target.name === name)?.user;
  const channel = targets.find((target) => target.kind === 'channel' && target.name === name);
  const online = useChatStore((state) => (user ? (state.online[user.id] ?? false) : false));
  const presence = useChatStore((state) => (user ? (state.presence[user.id] ?? 'online') : 'online'));
  if (user) {
    const status: UserStatus = online ? presence : 'offline';
    return (
      <span
        className={cn(
          'mention-chip inline-flex max-w-full items-center align-middle',
          // the chip is inline-flex, which sits on the baseline: nudge it onto the text line
          mirror ? 'relative -mb-px -mt-px gap-1 rounded-[3px] py-0 align-bottom leading-[inherit]' : 'translate-y-[2px] gap-1 rounded-sm py-0 leading-snug',
        )}
      >
        <span className={cn('relative inline-flex shrink-0', mirror && 'size-4')}>
          <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="xs" className="size-4 text-[8px]" />
          <StatusDots status={status} />
        </span>
        {/* the mirror reserves the characters behind the chip, so nothing after it drifts */}
        {mirror ? (
          <span className="absolute inset-0 -z-10 rounded-[3px] bg-brand-soft ring-1 ring-brand/40" aria-hidden />
        ) : null}
        {mirror && token ? (
          // inline-block hides it yet keeps its exact width, so the caret after the mention
          // lands where the next typed character appears
          <span className="inline-block text-transparent" aria-hidden>
            <span className="whitespace-pre">{token}</span>
          </span>
        ) : null}
        <span className="truncate">{name}</span>
      </span>
    );
  }
  if (channel) {
    return (
      <span className={cn('mention-chip inline-flex max-w-full items-center gap-0.5 rounded-sm px-0.5 align-middle', mirror ? 'leading-[inherit]' : 'leading-snug')}>
        <ChannelIcon voice={channel.channel} size={13} className="text-brand" />
        <span className="truncate">{name}</span>
      </span>
    );
  }
  return <span className="mention">{name}</span>;
}

/** Presence dot painted over the tiny avatar; it is decoration, the status is read in the member list. */
function StatusDots({ status }: { status: UserStatus }) {
  const color =
    status === 'online' ? 'bg-green' : status === 'idle' ? 'bg-yellow' : status === 'dnd' ? 'bg-red' : 'bg-muted';
  return (
    <span
      className={cn('absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-chat', color)}
      aria-hidden
    />
  );
}

/** Highlights where the typed text matched inside a suggestion row. */
export function HighlightedName({ name, query }: { name: string; query: string }): ReactNode {
  const start = query.trim() ? name.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()) : -1;
  if (start < 0) return name;
  const end = start + query.trim().length;
  return (
    <>
      {name.slice(0, start)}
      <strong className="font-semibold text-heading">{name.slice(start, end)}</strong>
      {name.slice(end)}
    </>
  );
}
