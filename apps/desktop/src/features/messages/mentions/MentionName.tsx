import type { LucideIcon } from 'lucide-react';
import { Hash, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
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
  if (user) {
    if (mirror) {
      // the textarea's own text sits under this mirror, so the chip covers it and the token
      // stays laid out invisibly: everything keeps the metrics it was typed with
      return (
        <span className="relative inline-block max-w-full align-top">
          <span className="invisible whitespace-pre">{token}</span>
          <span className="absolute inset-0 inline-flex max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-[3px] bg-brand-soft px-1 text-brand">
            <span className="relative inline-flex shrink-0">
              <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="xs" className="size-4 text-[8px]" />
            </span>
            <span className="truncate">{name}</span>
          </span>
        </span>
      );
    }
    return (
      <span className="mention-chip inline-flex max-w-full items-center gap-1 rounded-sm py-0 align-middle leading-snug">
        <span className="relative inline-flex shrink-0">
          <Avatar name={user.displayName} src={user.avatarUrl} color={user.accentColor} size="xs" className="size-4 text-[8px]" />
        </span>
        <span className="min-w-0 truncate">{name}</span>
      </span>
    );
  }
  if (channel) {
    if (mirror) {
      return (
        <span className="relative inline-block max-w-full align-top">
          <span className="invisible whitespace-pre">{token}</span>
          <span className="absolute inset-0 inline-flex max-w-full items-center gap-0.5 overflow-hidden whitespace-nowrap rounded-[3px] bg-brand-soft px-1 text-brand">
            <ChannelIcon voice={channel.channel} size={13} />
            <span className="truncate">{name}</span>
          </span>
        </span>
      );
    }
    return (
      <span className="mention-chip inline-flex max-w-full items-center gap-0.5 rounded-sm px-0.5 align-middle leading-snug">
        <ChannelIcon voice={channel.channel} size={13} className="text-brand" />
        <span className="min-w-0 truncate">{name}</span>
      </span>
    );
  }
  return <span className="mention">{name}</span>;
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
