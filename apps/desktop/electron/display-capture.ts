import { BrowserWindow, desktopCapturer, ipcMain, session, type Session } from 'electron';
import { join } from 'node:path';
import { DISPLAY_PICK_CHANNEL } from './shared/display-picker';
import { IPC, type CaptureApp, type CaptureMode } from './shared/ipc';
import { audioCaptureSupport, listAudioCaptureApps } from './audio-capture/service';

/** Quality picked in the last share dialog, read once by the renderer that asked. */
let lastPickedQuality: ShareQuality | null = null;
/** Quality the renderer last used; seeds the next dialog. */
let suggestedQuality: ShareQuality = { height: 720, frameRate: 30 };
let lastPickedAudio: { mode: CaptureMode; app?: CaptureApp } | null = null;

/**
 * Electron does not implement `getDisplayMedia` on its own: without this handler
 * every screen-share request fails with `NotSupportedError`. The handler lists
 * both screens and windows so the user picks what to share. Linux audio is
 * captured separately by the libpulse helper; the native loopback path is never used.
 */
export function registerDisplayCapture(
  target: Session = session.defaultSession,
  pick: PickSource = showSourcePicker,
): void {
  ipcMain.handle(IPC.setShareQuality, (_event, quality: Partial<ShareQuality>) => {
    suggestedQuality = {
      height: Number(quality?.height) || suggestedQuality.height,
      frameRate: Number(quality?.frameRate) || suggestedQuality.frameRate,
    };
  });
  // resolves in main before `getDisplayMedia` returns, so the renderer picks this
  // up right after and matches the running capture to what the dialog reported
  ipcMain.handle(IPC.consumeShareQuality, () => {
    const quality = lastPickedQuality;
    lastPickedQuality = null;
    return quality;
  });
  ipcMain.handle(IPC.consumeShareAudio, () => {
    const audio = lastPickedAudio;
    lastPickedAudio = null;
    return audio;
  });

  target.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        // the picker draws its own list; the thumbnails only feed it
        thumbnailSize: { width: 320, height: 180 },
      });
      if (sources.length === 0) {
        callback(null);
        return;
      }
      const audioSupport = process.platform === 'linux' ? await audioCaptureSupport() : { supported: false, reason: 'Captura de áudio está disponível apenas no Linux.' };
      const audioApps = audioSupport.supported ? await listAudioCaptureApps() : [];
      const chosen = await pick(sources, suggestedQuality, audioSupport, audioApps);
      if (!chosen) {
        callback(null);
        return;
      }
      lastPickedQuality = chosen.quality;
      lastPickedAudio = chosen.audio;
      suggestedQuality = chosen.quality;
      callback({ video: chosen.source });
    } catch {
      // no screen available (headless, denied by the OS): fail the request
      callback(null);
    }
  });
}

/** What the picker returns: the source, plus the quality to capture it at. */
export interface PickedShare {
  source: Electron.DesktopCapturerSource;
  quality: ShareQuality;
  audio: { mode: CaptureMode; app?: CaptureApp };
}

/** Resolves to the chosen source and quality, or null when the user cancels. */
export type PickSource = (
  sources: Electron.DesktopCapturerSource[],
  initial: ShareQuality,
  audioSupport: { supported: boolean; reason?: string },
  audioApps: CaptureApp[],
) => Promise<PickedShare | null>;

const DEFAULT_QUALITY: ShareQuality = { height: 720, frameRate: 30 };

/** Preferred capture size and frame rate, pre-filled from the saved settings. */
export interface ShareQuality {
  height: number;
  frameRate: number;
}

const SHARE_HEIGHTS = [480, 720, 1080, 1440, 2160] as const;
const SHARE_FRAME_RATES = [15, 24, 30, 60] as const;

const PICKER_WIDTH = 980;
const PICKER_HEIGHT = 660;
const PICKER_ITEM_WIDTH = 190;

const PICKER_STYLE = `
  body { font-family: system-ui, sans-serif; background: #1e1f22; color: #dbdee1; margin: 0; }
  .content { display: flex; height: 100vh; }
  nav { width: 170px; flex-shrink: 0; background: #2b2d31; padding: 10px; box-sizing: border-box; }
  nav button { display: block; width: 100%; border: 0; border-radius: 4px; padding: 8px 10px; margin-bottom: 2px;
    background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
  nav button[aria-selected="true"] { background: #404249; }
  #main { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 12px 14px; box-sizing: border-box; }
  #list { flex: 1; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, ${PICKER_ITEM_WIDTH}px);
    gap: 12px; align-content: start; }
  .item { border: 1px solid #3f4147; border-radius: 6px; background: #2b2d31; padding: 6px; cursor: pointer;
    color: inherit; font: inherit; font-size: 12px; text-align: left; }
  .item[aria-pressed="true"] { border-color: #5865f2; }
  .item img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; border-radius: 3px; }
  .item span { display: block; margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { grid-column: 1 / -1; color: #949ba4; font-size: 13px; }
  #quality { display: flex; gap: 16px; align-items: flex-end; padding-top: 12px; }
  #audio { display: flex; gap: 12px; align-items: flex-end; padding-top: 12px; }
  #audio label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #b5bac1; }
  #audio select { height: 32px; min-width: 180px; border-radius: 4px; border: 1px solid #3f4147; background: #1e1f22; color: inherit; font: inherit; padding: 0 8px; }
  #quality label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: #b5bac1; }
  #quality select { height: 32px; min-width: 120px; border-radius: 4px; border: 1px solid #3f4147; background: #1e1f22;
    color: inherit; font: inherit; font-size: 13px; padding: 0 8px; }
  footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; }
  footer button { border: 0; border-radius: 4px; padding: 9px 16px; font: inherit; font-size: 13px; cursor: pointer; }
  #cancel { background: transparent; color: inherit; }
  #cancel:hover { text-decoration: underline; }
  #share { background: #5865f2; color: #fff; }
  #share:disabled { background: #3f4147; cursor: default; }
`;

/** Renders the source list in a modal window; the choice comes back as the window result. */
function showSourcePicker(
  sources: Electron.DesktopCapturerSource[],
  initial: ShareQuality = DEFAULT_QUALITY,
  audioSupport: { supported: boolean; reason?: string } = { supported: false, reason: 'Captura indisponível.' },
  audioApps: CaptureApp[] = [],
): Promise<PickedShare | null> {
  const tabs = [
    sources.some((source) => source.id.startsWith('screen:')) ? { key: 'screen', label: 'Telas' } : null,
    sources.some((source) => source.id.startsWith('window:')) ? { key: 'window', label: 'Aplicativos' } : null,
  ].filter((tab): tab is { key: string; label: string } => tab !== null);

  const payload = JSON.stringify(
    sources.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() })),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PICKER_STYLE}</style></head><body>
<div class="content"><nav id="tabs" role="tablist"></nav><main id="main">
  <div id="list"></div>
  <div id="audio">
    <label>Áudio<select id="audioMode"></select></label>
    <label id="appLabel" hidden>Aplicativo<select id="audioApp"></select></label>
    <span id="audioStatus"></span>
  </div>
  <div id="quality">
    <label>Resolução<select id="height"></select></label>
    <label>Taxa de quadros<select id="fps"></select></label>
  </div>
  <footer><button id="cancel" type="button">Cancelar</button><button id="share" type="button" disabled>Transmitir</button></footer>
</main></div>
<script>
  const sources = ${payload};
  const tabs = ${JSON.stringify(tabs)};
  const initial = ${JSON.stringify(initial)};
  const audioSupport = ${JSON.stringify(audioSupport)};
  const audioApps = ${JSON.stringify(audioApps)};
  let audioChoice = { mode: 'desktop', app: null };
  let current = tabs[0]?.key ?? null;
  let selected = null;
  const list = document.getElementById('list');
  const tabsBar = document.getElementById('tabs');
  const share = document.getElementById('share');
  const heightSelect = document.getElementById('height');
  const fpsSelect = document.getElementById('fps');
  const audioMode = document.getElementById('audioMode');
  const audioApp = document.getElementById('audioApp');
  const appLabel = document.getElementById('appLabel');
  const audioStatus = document.getElementById('audioStatus');
  const finish = () => {
    if (selected === null || !audioSupport.supported || (audioMode.value === 'app' && !audioApp.value)) return;
    window.displayPicker.choose({
      id: selected,
      height: Number(heightSelect.value),
      frameRate: Number(fpsSelect.value),
      audioMode: audioMode.value,
      audioApp: audioApp.value,
    });
  };

  for (const height of ${JSON.stringify(SHARE_HEIGHTS)}) heightSelect.add(new Option(height + 'p', String(height)));
  for (const fps of ${JSON.stringify(SHARE_FRAME_RATES)}) fpsSelect.add(new Option(fps + ' fps', String(fps)));
  heightSelect.value = String(initial.height);
  fpsSelect.value = String(initial.frameRate);
  audioStatus.textContent = audioSupport.supported ? '' : (audioSupport.reason ?? 'Áudio indisponível');
  for (const [value, label] of [['desktop', 'Desktop (exclui Phanteon)'], ['app', 'Aplicativo específico']]) audioMode.add(new Option(label, value));
  audioMode.disabled = !audioSupport.supported;
  audioApp.disabled = !audioSupport.supported;
  for (const item of audioApps) audioApp.add(new Option(item.name, item.id));
  appLabel.hidden = true;
  audioMode.addEventListener('change', () => { appLabel.hidden = audioMode.value !== 'app'; });

  const renderTabs = () => {
    tabsBar.replaceChildren();
    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.textContent = tab.label;
      button.setAttribute('aria-selected', String(tab.key === current));
      button.addEventListener('click', () => { current = tab.key; render(); });
      tabsBar.append(button);
    }
  };

  const render = () => {
    renderTabs();
    list.replaceChildren();
    const visible = sources.filter((item) => item.id.startsWith(current + ':'));
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Nada para mostrar aqui.';
      list.append(empty);
    }
    for (const source of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item';
      button.setAttribute('aria-pressed', String(selected === source.id));
      const image = document.createElement('img');
      image.src = source.thumbnail;
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = source.name;
      button.append(image, label);
      button.addEventListener('click', () => { selected = source.id; render(); });
      button.addEventListener('dblclick', () => { selected = source.id; finish(); });
      list.append(button);
    }
    share.disabled = selected === null;
  };

  share.addEventListener('click', () => finish());
  document.getElementById('cancel').addEventListener('click', () => window.displayPicker.choose(null));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.displayPicker.choose(null);
  });
  render();
</script></body></html>`;

  return new Promise((resolve) => {
    let answered = false;
    const picker = new BrowserWindow({
      width: PICKER_WIDTH,
      height: PICKER_HEIGHT,
      parent: BrowserWindow.getFocusedWindow() ?? undefined,
      modal: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: 'Compartilhar',
      backgroundColor: '#1e1f22',
      webPreferences: {
        preload: pickerPreload(),
        contextIsolation: true,
        sandbox: false,
      },
    });
    picker.removeMenu();

    const onChoose = (event: Electron.IpcMainEvent, choice: unknown) => {
      // only the picker window itself may answer
      if (event.sender !== picker.webContents) return;
      if (!choice || typeof choice !== 'object') {
        close(null);
        return;
      }
      const { id, height, frameRate, audioMode, audioApp } = choice as { id?: unknown; height?: unknown; frameRate?: unknown; audioMode?: unknown; audioApp?: unknown };
      if (typeof id !== 'string') {
        close(null);
        return;
      }
      const source = sources.find((item) => item.id === id);
      const app = audioApps.find((item) => item.id === audioApp);
      if (!source || !audioSupport.supported || (audioMode !== 'app' && audioMode !== 'desktop') || (audioMode === 'app' && !app)) {
        close(null);
        return;
      }
      close({
        source,
        quality: { height: Number(height) || DEFAULT_QUALITY.height, frameRate: Number(frameRate) || DEFAULT_QUALITY.frameRate },
        audio: { mode: audioMode, ...(audioMode === 'app' && app ? { app } : {}) },
      });
    };
    const close = (picked: PickedShare | null) => {
      if (answered) return;
      answered = true;
      ipcMain.removeListener(DISPLAY_PICK_CHANNEL, onChoose);
      resolve(picked && sources.some((source) => source.id === picked.source.id) ? picked : null);
      if (!picker.isDestroyed()) picker.destroy();
    };
    ipcMain.on(DISPLAY_PICK_CHANNEL, onChoose);

    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void picker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    picker.on('closed', () => close(null));
  });
}

/**
 * The picker preload is bundled next to the main process in `dist-electron`.
 */
function pickerPreload(): string {
  return join(import.meta.dirname, 'display-picker-preload.js');
}
