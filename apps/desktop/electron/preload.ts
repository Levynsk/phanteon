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
  consumeShareAudio: () => ipcRenderer.invoke(IPC.consumeShareAudio),
  setShareQuality: (quality) => ipcRenderer.invoke(IPC.setShareQuality, quality),
  audioCaptureSupport: () => ipcRenderer.invoke(IPC.audioCaptureSupport),
  listAudioCaptureApps: () => ipcRenderer.invoke(IPC.listAudioCaptureApps),
  startAudioCapture: (mode, app) => ipcRenderer.invoke(IPC.startAudioCapture, mode, app),
  stopAudioCapture: () => ipcRenderer.invoke(IPC.stopAudioCapture),
  onAudioCapturePort: (listener) => {
    const handler = (event: Electron.IpcRendererEvent) => {
      const port = (event as Electron.IpcRendererEvent & { ports?: MessagePort[] }).ports?.[0];
      if (port) listener(port);
    };
    ipcRenderer.on(IPC.audioCapturePort, handler);
    return () => ipcRenderer.removeListener(IPC.audioCapturePort, handler);
  },
  onAudioCaptureError: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on(IPC.audioCaptureError, handler);
    return () => ipcRenderer.removeListener(IPC.audioCaptureError, handler);
  },
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
