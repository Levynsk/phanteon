import type { SocketStatus, VoiceState } from '@phanteon/shared';
import { create } from 'zustand';

export type UserSettingsSection =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'voice'
  | 'audit';

export type ModalKind =
  | { kind: 'create-server' }
  | { kind: 'guild-settings'; guildId: string; section?: 'overview' | 'channels' | 'roles' | 'members' | 'bans' | 'audit' }
  | { kind: 'ban-member'; guildId: string; userId: string; displayName: string }
  | { kind: 'create-channel'; guildId: string; type?: 'text' | 'voice'; categoryId?: string | null }
  | { kind: 'create-category'; guildId: string }
  | { kind: 'channel-settings'; guildId: string; channelId: string }
  | { kind: 'invite'; guildId: string }
  | { kind: 'join-server' }
  | { kind: 'user-settings'; section?: UserSettingsSection }
  | { kind: 'profile' }
  | { kind: 'user-profile'; userId: string; guildId?: string; at: { x: number; y: number } }
  | { kind: 'new-dm' }
  | { kind: 'add-friend' }
  | { kind: 'confirm'; title: string; description: string; confirmLabel: string; onConfirm: () => Promise<void> | void }
  | { kind: 'lightbox'; items: LightboxItem[]; index: number; openedAt: number }
  | null;

/** One image of the full-screen viewer; `url` is already resolved for the current session. */
export interface LightboxItem {
  id: string;
  url: string;
  filename: string;
  width: number | null;
  height: number | null;
}

/** Actions for one person in a call, opened by right-clicking their card. `at` is viewport px. */
export interface PersonMenu {
  at: { x: number; y: number };
  state: VoiceState;
  guildId: string;
  gain: number;
  canModerate: boolean;
  onVolume: (gain: number) => void;
  onProfile: () => void;
}

export type ResizablePanelId = 'members' | 'voice-chat';

/** Bounds and default width of each panel the user can widen; the chat always keeps the larger share. */
export const PANEL_WIDTH: Record<ResizablePanelId, { min: number; max: number; initial: number }> = {
  members: { min: 200, max: 420, initial: 240 },
  'voice-chat': { min: 300, max: 640, initial: 340 },
};

export function clampPanelWidth(id: ResizablePanelId, width: number): number {
  const { min, max } = PANEL_WIDTH[id];
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** Message the composer is currently replying to (per channel). */
export interface ReplyTarget {
  channelId: string;
  id: string;
  authorName: string;
  preview: string;
}

interface UiState {
  modal: ModalKind;
  reply: ReplyTarget | null;
  personMenu: PersonMenu | null;
  openPersonContextMenu: (menu: PersonMenu) => void;
  closePersonMenu: () => void;
  memberListOpen: boolean;
  /** Widths chosen by dragging the panels' inner edges, kept only for this session. */
  panelWidths: Record<ResizablePanelId, number>;
  setPanelWidth: (id: ResizablePanelId, width: number) => void;
  searchOpen: boolean;
  socketStatus: SocketStatus;
  openModal: (modal: Exclude<ModalKind, null>) => void;
  /** Opens the viewer on one image of a message; `openedAt` lets a second click restart it. */
  openLightbox: (items: LightboxItem[], index: number) => void;
  openUserProfile: (userId: string, guildId?: string, at?: { x: number; y: number }, fallback?: HTMLElement | null) => void;
  closeModal: () => void;
  toggleMemberList: () => void;
  setSearchOpen: (open: boolean) => void;
  setSocketStatus: (status: SocketStatus) => void;
  startReply: (target: ReplyTarget) => void;
  clearReply: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  reply: null,
  personMenu: null,
  openPersonContextMenu: (personMenu) => set({ personMenu }),
  closePersonMenu: () => set({ personMenu: null }),
  memberListOpen: true,
  panelWidths: { members: PANEL_WIDTH.members.initial, 'voice-chat': PANEL_WIDTH['voice-chat'].initial },
  setPanelWidth: (id, width) => set((state) => ({ panelWidths: { ...state.panelWidths, [id]: clampPanelWidth(id, width) } })),
  searchOpen: false,
  socketStatus: 'closed',
  // dialog state is deferred one microtask so a Radix menu/context-menu that is
  // closing (onSelect) cannot pull focus back and unmount the fresh dialog.
  openModal: (modal) => setTimeout(() => set({ modal }), 0),
  openLightbox: (items, index) => set({
    modal: { kind: 'lightbox', items, index: Math.min(Math.max(0, index), Math.max(0, items.length - 1)), openedAt: Date.now() },
    personMenu: null,
  }),
  openUserProfile: (userId, guildId, at, fallback) => {
    const bounds = fallback?.getBoundingClientRect();
    const position = at && (at.x !== 0 || at.y !== 0) ? at : (bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setTimeout(() => set({ modal: { kind: 'user-profile', userId, guildId, at: position }, personMenu: null }), 0);
  },
  // a person's menu never survives a dialog opening (profile, confirmations)
  closeModal: () => set({ modal: null, personMenu: null }),
  toggleMemberList: () => set((state) => ({ memberListOpen: !state.memberListOpen })),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSocketStatus: (socketStatus) => set({ socketStatus }),
  startReply: (reply) => set({ reply }),
  clearReply: () => set({ reply: null }),
}));
