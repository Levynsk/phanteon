import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DesktopApi, type WindowAction } from './shared/ipc';

const api: DesktopApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
  appVersion: () => ipcRenderer.invoke(IPC.appVersion),
  apiBaseUrl: () => ipcRenderer.invoke(IPC.apiBaseUrl),
  consumeShareQuality: () => ipcRenderer.invoke(IPC.consumeShareQuality),
  setShareQuality: (quality) => ipcRenderer.invoke(IPC.setShareQuality, quality),
  window: {
    minimize: () => ipcRenderer.send(IPC.windowAction, 'minimize' satisfies WindowAction),
    toggleMaximize: () => ipcRenderer.send(IPC.windowAction, 'maximize' satisfies WindowAction),
    close: () => ipcRenderer.send(IPC.windowAction, 'close' satisfies WindowAction),
    isMaximized: () => ipcRenderer.invoke(IPC.windowMaximizedQuery),
    onMaximizedChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on(IPC.windowMaximizedEvent, handler);
      return () => ipcRenderer.removeListener(IPC.windowMaximizedEvent, handler);
    },
  },
  onDeepLink: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url);
    ipcRenderer.on(IPC.deepLink, handler);
    return () => ipcRenderer.removeListener(IPC.deepLink, handler);
  },
};

contextBridge.exposeInMainWorld('desktop', api);
