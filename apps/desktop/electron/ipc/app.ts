import { app, ipcMain } from 'electron';
import { IPC } from '../shared/ipc';

/** Dev talks to the API on this machine; the packaged app talks to the public host. */
const DEV_API_URL = 'http://localhost:3010';
const PROD_API_URL = 'https://phanteon.bonfires.eu.cc';

export function resolveApiBaseUrl(): string {
  // an explicit override always wins, for staging or a self-hosted API
  const override = process.env.API_URL?.trim();
  if (override) return override;
  return app.isPackaged ? PROD_API_URL : DEV_API_URL;
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC.appVersion, () => app.getVersion());
  ipcMain.handle(IPC.apiBaseUrl, () => resolveApiBaseUrl());
}
