import type { GuildWithDetails, PublicUser } from '@phanteon/shared';

/**
 * Mentions are plain text in the message: `@Display Name` for a person and
 * `#channel-name` for a channel. Display names carry spaces, so the token is
 * matched against the known people and channels, longest name first.
 */
export interface MentionTarget {
  kind: 'user' | 'channel';
  /** Stable id used to draw the avatar or channel icon. */
  id: string;
  /** Full name shown to the user. */
  name: string;
  /** The person, when the target is a user outside the member list. */
  user?: PublicUser;
  /** True for a voice channel, so the icon is a speaker instead of a `#`. */
  channel?: boolean;
}

export type MentionToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; kind: 'user' | 'channel'; name: string };

/** A finished mention in the composer, kept as a single unit while the text changes around it. */
export interface MentionSpan {
  start: number;
  token: string;
  length: number;
}

/** One `@` or `#` being typed, from the trigger until the caret. */
export interface MentionQuery {
  kind: 'user' | 'channel';
  query: string;
  start: number;
  end: number;
}

/** Characters after `@`/`#` that belong to the name being typed; no newlines and no crossing another trigger. */
const QUERY_CHAR = /[\p{L}\p{N}_.\- ]/u;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return /\s/.test(text[index - 1] ?? '');
}

/**
 * The `@name` or `#name` around the caret, or null when the caret is not inside
 * one. Finished mentions (`atoms`) are skipped whole, so placing the caret near
 * one never turns it back into a query.
 */
export function activeMention(text: string, caret: number, options: { atoms?: string[] } = {}): MentionQuery | null {
  const position = Math.min(Math.max(0, caret), text.length);
  for (const atom of options.atoms ?? []) {
    const start = position - atom.length;
    // at the end of the text there is no next character to break on, so any atom there counts
    if (start >= 0 && text.startsWith(atom, start) && (start === 0 || /\s/.test(text[start - 1] ?? ''))) return null;
  }
  let index = position - 1;
  while (index >= 0 && QUERY_CHAR.test(text[index] ?? '')) index -= 1;
  const trigger = text[index];
  if (index < 0 || (trigger !== '@' && trigger !== '#')) return null;
  if (!isBoundary(text, index)) return null;
  const query = text.slice(index + 1, position);
  // a space after a finished-looking name closes the list instead of keeping it open
  if (query.endsWith(' ')) return null;
  return { kind: trigger === '@' ? 'user' : 'channel', query, start: index, end: position };
}

/**
 * Targets whose name starts with what is being typed, best match first. Names
 * carry spaces, so matching from the start keeps `@Ana Lim` from suggesting
 * someone else halfway through a mention that is already complete.
 */
export function mentionSuggestions(targets: MentionTarget[], query: MentionQuery, limit = 8): MentionTarget[] {
  const needle = query.query.toLocaleLowerCase();
  const kind = query.kind === 'user' ? 'user' : 'channel';
  return targets
    .filter((target) => target.kind === kind && target.name.toLocaleLowerCase().startsWith(needle))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** UTF-16 length, the unit the message limit and the UI counter share. */
export function codeUnits(text: string): number {
  return text.length;
}

/** The text with every finished mention taken out as one unit; it is what the mirror measures. */
export function textWithoutMentions(text: string, atoms: string[]): string {
  let rest = text;
  for (const atom of [...atoms].sort((a, b) => b.length - a.length)) rest = rest.split(atom).join('');
  return rest;
}

/** Targets just for the names inside `tokens`, so the composer can highlight what it just inserted. */
export function textTargets(guild: GuildWithDetails | undefined, tokens: string[]): MentionTarget[] {
  if (!guild || tokens.length === 0) return [];
  const targets: MentionTarget[] = [];
  for (const token of tokens) {
    const name = token.slice(1);
    if (token.startsWith('@')) {
      const member = guild.members.find((entry) => entry.user.displayName === name);
      if (member && !targets.some((target) => target.kind === 'user' && target.name === name)) {
        targets.push({ kind: 'user', id: member.user.id, name, user: member.user });
      }
    } else if (!targets.some((target) => target.kind === 'channel' && target.name === name)) {
      const channel = guild.channels.find((entry) => entry.name === name);
      if (channel) targets.push({ kind: 'channel', id: channel.id, name, channel: channel.type === 'voice' });
    }
  }
  return targets;
}

/** Human form of a target: what the message stores and what the reader sees. */
export function mentionToken(target: MentionTarget): string {
  return `${target.kind === 'user' ? '@' : '#'}${target.name}`;
}

/**
 * Replaces the typed query with the chosen token and reports where the caret
 * lands, so the composer can carry on typing right after the mention.
 */
export function applyMention(
  text: string,
  query: MentionQuery,
  target: MentionTarget,
): { text: string; caret: number } {
  const token = mentionToken(target);
  const before = text.slice(0, query.start);
  const after = text.slice(query.end);
  // a channel mention reads as a word: keep the following space from being swallowed
  const tail = after.startsWith(' ') || after.length === 0 ? after : ` ${after}`;
  const next = `${before}${token}${tail}`;
  return { text: next, caret: before.length + token.length };
}

/**
 * Splits `content` so known people and channels can be drawn as chips. Anything
 * unknown stays literal text, which keeps the pass cheap on every message.
 */
export function splitMentions(content: string, targets: MentionTarget[]): MentionToken[] {
  if (!content.includes('@') && !content.includes('#')) return [{ type: 'text', value: content }];
  const names = targets.filter((target) => target.name.length > 0).sort((a, b) => b.name.length - a.name.length);
  const tokens: MentionToken[] = [];
  let text = '';
  let index = 0;

  while (index < content.length) {
    const trigger = content[index];
    const kind = trigger === '@' ? 'user' : trigger === '#' ? 'channel' : null;
    const target =
      kind && isBoundary(content, index)
        ? names.find((candidate) => {
            if (candidate.kind !== kind) return false;
            const end = index + 1 + candidate.name.length;
            if (!content.startsWith(candidate.name, index + 1)) return false;
            // the name must end at a word break, so `@Ana` never matches inside `@Ana Lima`
            return end >= content.length || /\s/.test(content[end] ?? '');
          })
        : undefined;

    if (target) {
      if (text) tokens.push({ type: 'text', value: text });
      text = '';
      tokens.push({ type: 'mention', kind: target.kind, name: target.name });
      index += target.name.length + 1;
      continue;
    }
    text += trigger;
    index += 1;
  }

  if (text) tokens.push({ type: 'text', value: text });
  return tokens;
}
