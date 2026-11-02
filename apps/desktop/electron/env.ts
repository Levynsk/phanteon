import { app } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder of the bundled main process (`dist-electron/`). */
const bundleDir = dirname(fileURLToPath(import.meta.url));

export const is = {
  get dev(): boolean {
    return !app.isPackaged;
  },
};

/** Points at the Vite dev server or the built renderer on disk. */
export function resolveRendererTarget(): { url: string } | { file: string } {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (is.dev && devServerUrl) return { url: devServerUrl };
  return { file: join(dirname(bundleDir), 'dist', 'index.html') };
}
