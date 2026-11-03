import { describe, expect, test } from 'bun:test';
import { activeMention, applyMention, mentionSuggestions, splitMentions, type MentionTarget } from '../src/lib/mentions';

const ana: MentionTarget = { kind: 'user', id: 'u1', name: 'Ana' };
const anaLima: MentionTarget = { kind: 'user', id: 'u2', name: 'Ana Lima' };
const bob: MentionTarget = { kind: 'user', id: 'u3', name: 'Bob' };
const general: MentionTarget = { kind: 'channel', id: 'c1', name: 'geral' };
const voice: MentionTarget = { kind: 'channel', id: 'c2', name: 'voz-geral', channel: true };
const TARGETS = [ana, anaLima, bob, general, voice];

describe('the @ / # being typed', () => {
  test('returns the trigger and the typed name', () => {
    expect(activeMention('oi @An', 6)).toEqual({ kind: 'user', query: 'An', start: 3, end: 6 });
    expect(activeMention('vai pra #ge', 11)).toEqual({ kind: 'channel', query: 'ge', start: 8, end: 11 });
  });

  test('a trailing space closes the list', () => {
    expect(activeMention('@Ana Lima ', 10, { atoms: ['@Ana Lima'] })).toBeNull();
    expect(activeMention('@Ana ', 5)).toBeNull();
  });

  test('names with spaces stay one query', () => {
    expect(activeMention('@Ana Li', 7)).toMatchObject({ query: 'Ana Li', start: 0 });
  });

  test('an email or a hash inside a word is not a mention', () => {
    expect(activeMention('ana@mail', 8)).toBeNull();
    expect(activeMention('item#1', 6)).toBeNull();
  });

  test('a newline ends the query', () => {
    expect(activeMention('@ana\nlima', 9)).toBeNull();
  });

  test('a bare trigger suggests everything', () => {
    expect(activeMention('@', 1)).toMatchObject({ query: '', kind: 'user' });
  });

  test('a space after a picked mention closes the list, and new text does not reopen it', () => {
    const atoms = ['@Ana Lima'];
    expect(activeMention('@Ana Lima ', 10, { atoms })).toBeNull();
    // plain words are not a mention, so nothing is being picked while typing them
    expect(activeMention('@Ana Lima oi', 12, { atoms })).toBeNull();
    // a new trigger after the finished mention opens a new list
    expect(activeMention('@Ana Lima oi #ge', 16, { atoms })).toMatchObject({ start: 13, query: 'ge' });
  });

  test('a mention already picked is never read back as a query', () => {
    const text = 'oi @Ana Lima e #geral';
    const atoms = ['@Ana Lima', '#geral'];
    // caret at the end of each finished name, where no following character breaks the token,
    // and right after the last one, where there is no following character to break on
    expect(activeMention(text, 12, { atoms: ['@Ana Lima'] })).toBeNull();
    expect(activeMention(text, 8, { atoms })).toBeNull();
    expect(activeMention('oi #geral', 9, { atoms: ['#geral'] })).toBeNull();
  });

  test('typing after a finished mention opens a new one', () => {
    expect(activeMention('oi @Ana Lima @Bo', 17, { atoms: ['@Ana Lima'] })).toMatchObject({ query: 'Bo', start: 13 });
  });
});

describe('suggestions', () => {
  const query = { kind: 'user' as const, query: 'ana', start: 0, end: 4 };

  test('only names that start with the typed text are suggested', () => {
    const names = mentionSuggestions([bob, anaLima, ana], query).map((target) => target.name);
    expect(names).toEqual(['Ana', 'Ana Lima']);
    expect(mentionSuggestions([bob], { ...query, query: 'ob' })).toEqual([]);
  });

  test('a finished name does not suggest other names that contain it', () => {
    expect(mentionSuggestions(TARGETS, { ...query, query: 'Ana Lima ' })).toEqual([]);
  });

  test('channels answer only to #', () => {
    const channels = mentionSuggestions(TARGETS, { ...query, kind: 'channel', query: 'ger' }).map((target) => target.name);
    expect(channels).toEqual(['geral']);
    expect(mentionSuggestions(TARGETS, { ...query, kind: 'channel', query: 'voz' }).map((target) => target.name)).toEqual(['voz-geral']);
  });

  test('is case insensitive and capped', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ kind: 'user' as const, id: `m${index}`, name: `Membro ${index}` }));
    expect(mentionSuggestions(many, { ...query, query: 'membro' }, 5)).toHaveLength(5);
  });
});

describe('inserting a mention', () => {
  test('replaces the typed query and leaves the caret after the name', () => {
    expect(applyMention('oi @An tudo bem', { kind: 'user', query: 'An', start: 3, end: 6 }, anaLima)).toEqual({
      text: 'oi @Ana Lima tudo bem',
      caret: 12,
    });
  });

  test('a channel keeps the following space readable', () => {
    expect(applyMention('vai #ge', { kind: 'channel', query: 'ge', start: 4, end: 7 }, general).text).toBe('vai #geral');
  });
});

describe('rendering saved mentions', () => {
  test('known people and channels become chips', () => {
    expect(splitMentions('oi @Ana Lima e @Bob vejam #voz-geral', TARGETS)).toEqual([
      { type: 'text', value: 'oi ' },
      { type: 'mention', kind: 'user', name: 'Ana Lima' },
      { type: 'text', value: ' e ' },
      { type: 'mention', kind: 'user', name: 'Bob' },
      { type: 'text', value: ' vejam ' },
      { type: 'mention', kind: 'channel', name: 'voz-geral' },
    ]);
  });

  test('the longest name wins over a prefix', () => {
    expect(splitMentions('@Ana Lima', TARGETS)[0]).toEqual({ type: 'mention', kind: 'user', name: 'Ana Lima' });
  });

  test('unknown names and emails stay text', () => {
    expect(splitMentions('@Ninguem ana@mail.com', TARGETS)).toEqual([{ type: 'text', value: '@Ninguem ana@mail.com' }]);
  });

  test('mentions only match at a word start', () => {
    expect(splitMentions('x@Bob', TARGETS)).toEqual([{ type: 'text', value: 'x@Bob' }]);
  });
});
