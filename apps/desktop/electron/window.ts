import { app, BrowserWindow, screen, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { is, resolveRendererTarget } from './env';
import { isExternalLinkAllowed } from './external-links';
import { IPC } from './shared/ipc';

const TITLEBAR_HEIGHT = 36;
/** Same rule as `is.dev`, read before `app` is ready (window is created later, but keep one source). */
const OPEN_DEVTOOLS = !app.isPackaged;
const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
/** The DevTools window opened for the main window, so toggles can reuse it. */
let devToolsWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#000000',
    title: 'Phanteon',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform === 'linux' ? { titleBarOverlay: false } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow = window;

  const target = resolveRendererTarget();
  if ('url' in target) {
    void window.loadURL(target.url);
  } else {
    void window.loadFile(target.file);
  }

  let shown = false;
  const show = () => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
  };

  window.once('ready-to-show', () => {
    if (process.env.ELECTRON_START_HIDDEN === '1') return;
    show();
    if (OPEN_DEVTOOLS) openDetachedDevTools(window);
  });

  if (!is.dev) {
    setTimeout(show, 4000);
  }

  window.webContents.on('before-input-event', (event, input) => {
    if (!is.dev) return;
    const isRefresh = input.key.toLowerCase() === 'r' && (input.control || input.meta);
    const isDevTools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (isRefresh) {
      event.preventDefault();
      window.webContents.reload();
    } else if (isDevTools) {
      toggleDetachedDevTools(window);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    // the global handler in main.ts already filters; this window-level one overrode it
    if (isExternalLinkAllowed(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const emitMaximized = () => {
    if (!window.isDestroyed()) window.webContents.send(IPC.windowMaximizedEvent, window.isMaximized());
  };
  window.on('maximize', emitMaximized);
  window.on('unmaximize', emitMaximized);

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  return window;
}

/**
 * Opens the renderer DevTools in their own OS window beside the app, so the
 * inspector never shrinks the layout.
 */
function openDetachedDevTools(window: BrowserWindow): void {
  const contents = window.webContents;
  if (contents.isDevToolsOpened()) return;
  contents.openDevTools({ mode: 'detach' });
  contents.once('devtools-opened', () => {
    const devToolsContents = contents.devToolsWebContents;
    if (!devToolsContents) return;
    const devTools = BrowserWindow.fromWebContents(devToolsContents);
    if (!devTools || devTools.isDestroyed()) return;
    const rect = window.getBounds();
    const { workArea } = screen.getDisplayMatching(rect);
    const width = 560;
    const height = Math.min(720, workArea.height - 40);
    const x = Math.min(rect.x + rect.width + 16, workArea.x + workArea.width - width - 8);
    const y = Math.max(workArea.y + 8, Math.min(rect.y + 8, workArea.y + workArea.height - height - 8));
    // when there is no room beside the app, stack it over the window's right edge
    const targetX = x < workArea.x ? Math.max(workArea.x + 8, rect.x + rect.width - width) : x;
    devTools.setBounds({ x: targetX, y, width, height });
  });
}

function toggleDetachedDevTools(window: BrowserWindow): void {
  const contents = window.webContents;
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
    return;
  }
  openDetachedDevTools(window);
}

export function focusMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

export { TITLEBAR_HEIGHT };
