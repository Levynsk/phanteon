import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearTypingTimers,
  scheduleTypingClear,
  useChatStore,
} from '../src/app/stores/chat';
import { useAuthStore } from '../src/app/stores/auth';
import { shouldLeaveGuildOnError } from '../src/pages/AppPage';

afterEach(() => {
  clearTypingTimers();
  useChatStore.getState().reset();
});

describe('typing indicator', () => {
  test('a user who keeps typing stays visible instead of vanishing after 6s', async () => {
    const channelId = 'canal-1';
    const userId = 'u1';
    useChatStore.setState({ typing: { [channelId]: [{ user: { id: userId } as never, at: 0 }] } });

    // the server re-sends every ~3s, so the clear must be re-armed each packet
    scheduleTypingClear(80, channelId, userId, () => useChatStore.getState().clearChannelTyping(channelId, userId));
    await Bun.sleep(50);
    scheduleTypingClear(80, channelId, userId, () => useChatStore.getState().clearChannelTyping(channelId, userId));

    await Bun.sleep(50); // 100ms after the first packet, 50ms after the last: still typing
    expect(useChatStore.getState().typing[channelId]).toHaveLength(1);

    await Bun.sleep(60); // now past the last packet's window
    expect(useChatStore.getState().typing[channelId]).toBeUndefined();
  });

  test('reset cancels pending timers so they never land in the next account', async () => {
    const channelId = 'canal-2';
    const userId = 'u2';
    scheduleTypingClear(30, channelId, userId, () => useChatStore.getState().clearChannelTyping(channelId, userId));
    useChatStore.getState().reset();
    await Bun.sleep(60);
    expect(useChatStore.getState().typing).toEqual({});
  });
});

describe('guild load failures', () => {
  test('a network blip or server error does not look like a logout', () => {
    expect(shouldLeaveGuildOnError(new TypeError('Failed to fetch'))).toBe(false);
    expect(shouldLeaveGuildOnError({ status: 500 })).toBe(false);
    expect(shouldLeaveGuildOnError({ status: 502 })).toBe(false);
    expect(shouldLeaveGuildOnError(undefined)).toBe(false);
  });

  test('only "not yours" answers send the user home', () => {
    expect(shouldLeaveGuildOnError({ status: 403 })).toBe(true);
    expect(shouldLeaveGuildOnError({ status: 404 })).toBe(true);
  });
});

describe('switching accounts', () => {
  test('logout clears the previous account data before the next login', () => {
    useChatStore.setState({
      guilds: [{ id: 'g1' } as never],
      messages: { c1: { items: [] as never, hasMore: false, loaded: true } },
    });
    useAuthStore.setState({ token: 'old-token', status: 'authenticated' });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().token).toBeNull();
    expect(useChatStore.getState().guilds).toEqual([]);
    expect(useChatStore.getState().messages).toEqual({});
  });
});
