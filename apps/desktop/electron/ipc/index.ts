import { ipcMain } from 'electron';
import { getMainWindow } from '../window';
import { IPC, type WindowAction } from '../shared/ipc';
import { registerAppHandlers } from './app';

export function registerIpc(): void {
  registerAppHandlers();

  ipcMain.on(IPC.windowAction, (_event, action: WindowAction) => {
    const window = getMainWindow();
    if (!window) return;
    switch (action) {
      case 'minimize':
        window.minimize();
        break;
      case 'maximize':
        window.isMaximized() ? window.unmaximize() : window.maximize();
        break;
      case 'close':
        window.close();
        break;
    }
  });

  ipcMain.handle(IPC.windowMaximizedQuery, () => getMainWindow()?.isMaximized() ?? false);
}
