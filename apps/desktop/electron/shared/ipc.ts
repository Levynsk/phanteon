export type WindowAction = 'minimize' | 'maximize' | 'close';

export interface DesktopApi {
  platform: string;
  versions: { electron: string; chrome: string; node: string };
  appVersion: () => Promise<string>;
  apiBaseUrl: () => Promise<string>;
  /**
   * Quality chosen in the share picker for the request that is in flight. The
   * picker resolves `getDisplayMedia` from main, so the renderer reads it to ask
   * for matching constraints.
   */
  consumeShareQuality: () => Promise<{ height: number; frameRate: number } | null>;
  /** Pre-fills the share picker with the quality last used. */
  setShareQuality: (quality: { height: number; frameRate: number }) => Promise<void>;
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (listener: (maximized: boolean) => void) => () => void;
  };
  onDeepLink: (listener: (url: string) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export const IPC = {
  appVersion: 'app:version',
  apiBaseUrl: 'app:api-base-url',
  consumeShareQuality: 'display-capture:consume-quality',
  setShareQuality: 'display-capture:set-quality',
  windowAction: 'window:action',
  windowMaximizedQuery: 'window:is-maximized',
  windowMaximizedEvent: 'window:maximized-changed',
  deepLink: 'app:deep-link',
} as const;
