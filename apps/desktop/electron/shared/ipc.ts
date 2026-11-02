export type WindowAction = 'minimize' | 'maximize' | 'close';
export type CaptureMode = 'app' | 'desktop';
export interface CaptureApp { id: string; name: string; pid: number; binary: string }

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
  consumeShareAudio: () => Promise<{ mode: CaptureMode; app?: CaptureApp } | null>;
  /** Pre-fills the share picker with the quality last used. */
  setShareQuality: (quality: { height: number; frameRate: number }) => Promise<void>;
  audioCaptureSupport: () => Promise<{ supported: boolean; reason?: string }>;
  listAudioCaptureApps: () => Promise<CaptureApp[]>;
  startAudioCapture: (mode: CaptureMode, app?: CaptureApp) => Promise<void>;
  stopAudioCapture: () => Promise<void>;
  onAudioCapturePort: (listener: (port: MessagePort) => void) => () => void;
  onAudioCaptureError: (listener: (message: string) => void) => () => void;
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
  consumeShareAudio: 'display-capture:consume-audio',
  setShareQuality: 'display-capture:set-quality',
  audioCaptureSupport: 'audio-capture:support',
  listAudioCaptureApps: 'audio-capture:list-apps',
  startAudioCapture: 'audio-capture:start',
  stopAudioCapture: 'audio-capture:stop',
  audioCapturePort: 'audio-capture:port',
  audioCaptureError: 'audio-capture:error',
  windowAction: 'window:action',
  windowMaximizedQuery: 'window:is-maximized',
  windowMaximizedEvent: 'window:maximized-changed',
  deepLink: 'app:deep-link',
} as const;
