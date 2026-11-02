import type { AuthSession, PublicUser, UserStatus } from '@phanteon/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, configureApi } from '../../lib/api';
import { useChatStore } from './chat';

// Registered at module load so requests made before any screen mounts
// (e.g. session restore) still carry the token.
configureApi({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => {
    useAuthStore.getState().logout();
    useChatStore.getState().reset();
  },
});

interface AuthState {
  token: string | null;
  user: PublicUser | null;
  status: 'idle' | 'authenticating' | 'authenticated' | 'guest';
  error: string | null;
  login: (identifier: string, password: string) => Promise<boolean>;
  register: (input: { username: string; displayName?: string; email: string; password: string }) => Promise<boolean>;
  logout: () => void;
  restore: () => Promise<void>;
  updateProfile: (input: {
    displayName?: string;
    status?: UserStatus;
    accentColor?: string;
    avatarUrl?: string | null;
    bannerUrl?: string | null;
    bio?: string | null;
  }) => Promise<void>;
  applyUserUpdate: (user: PublicUser) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      status: 'idle',
      error: null,

      login: async (identifier, password) => {
        set({ status: 'authenticating', error: null });
        try {
          const session = await api.auth.login({ identifier, password });
          set({ token: session.token, user: session.user, status: 'authenticated' });
          return true;
        } catch (error) {
          set({ status: 'guest', error: error instanceof Error ? error.message : 'Falha ao entrar.' });
          return false;
        }
      },

      register: async (input) => {
        set({ status: 'authenticating', error: null });
        try {
          const session: AuthSession = await api.auth.register(input);
          set({ token: session.token, user: session.user, status: 'authenticated' });
          return true;
        } catch (error) {
          set({ status: 'guest', error: error instanceof Error ? error.message : 'Falha ao criar conta.' });
          return false;
        }
      },

      logout: () => {
        // chat state (guilds, messages, unread, presence) is per account: wipe it here so a
        // different login never sees the previous user's data while bootstrap is in flight
        useChatStore.getState().reset();
        set({ token: null, user: null, status: 'guest', error: null });
      },

      restore: async () => {
        const { token } = get();
        if (!token) {
          set({ status: 'guest' });
          return;
        }
        try {
          const { user } = await api.auth.me();
          set({ user, status: 'authenticated' });
        } catch {
          set({ token: null, user: null, status: 'guest' });
        }
      },

      updateProfile: async (input) => {
        const { user } = await api.users.updateMe(input);
        set({ user });
      },

      applyUserUpdate: (user) => {
        if (get().user?.id === user.id) set({ user });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'phanteon-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);
