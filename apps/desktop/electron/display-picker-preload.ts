import { contextBridge, ipcRenderer } from 'electron';
import { DISPLAY_PICK_CHANNEL, type DisplayPickChoice } from './shared/display-picker';

contextBridge.exposeInMainWorld('displayPicker', {
  choose: (choice: DisplayPickChoice | null) => ipcRenderer.send(DISPLAY_PICK_CHANNEL, choice),
});
