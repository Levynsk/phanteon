import type { DesktopApi } from '../../electron/shared/ipc';

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};
