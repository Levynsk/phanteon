import { app, ipcMain, MessageChannelMain, type WebContents } from 'electron';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { IPC, type CaptureApp, type CaptureMode } from '../shared/ipc';

interface PulseStream extends CaptureApp { index: number; sink: number }
type CaptureProcess = ChildProcessByStdio<null, Readable, Readable>;
let active: { child: CaptureProcess; owner: WebContents; port: Electron.MessagePortMain } | null = null;
let starting: Promise<void> = Promise.resolve();
const MAX_PCM_BYTES_PER_SECOND = 1_048_576;
const MAX_STDERR_BYTES = 16_384;

function appendStderr(current: string, chunk: string): string {
  return (current + chunk).slice(-MAX_STDERR_BYTES);
}

export type AudioCapturePlatform = 'linux' | 'win32';

export function helperName(platform: AudioCapturePlatform): string {
  return platform === 'win32' ? 'wasapi-capture.exe' : 'pulse-capture';
}

export function resolveHelperPath(platform: AudioCapturePlatform, packaged: boolean, resourcesPath: string, moduleDir: string): string {
  const name = helperName(platform);
  return packaged
    ? join(resourcesPath, 'audio-capture', name)
    : join(moduleDir, 'audio-capture', name);
}

function helperPath(): string {
  return resolveHelperPath(process.platform as AudioCapturePlatform, app.isPackaged, process.resourcesPath, import.meta.dirname);
}

function runHelper<T = PulseStream[]>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1_048_576) { child.kill('SIGTERM'); }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = appendStderr(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || (process.platform === 'win32' ? 'WASAPI indisponível.' : 'PipeWire-Pulse indisponível.')));
      try { resolve(JSON.parse(stdout) as T); } catch { reject(new Error('Resposta inválida do helper de áudio.')); }
    });
  });
}

export async function audioCaptureSupport(): Promise<{ supported: boolean; reason?: string }> {
  if (process.platform === 'win32') {
    try { await runHelper<Record<string, never>>(['probe']); return { supported: true }; }
    catch (error) { return { supported: false, reason: error instanceof Error ? error.message : 'WASAPI indisponível.' }; }
  }
  if (process.platform !== 'linux') return { supported: false, reason: 'Captura de áudio indisponível nesta plataforma.' };
  try { await runHelper<PulseStream[]>(['list']); return { supported: true }; }
  catch (error) { return { supported: false, reason: error instanceof Error ? error.message : 'PipeWire-Pulse indisponível.' }; }
}

export async function listAudioCaptureApps(): Promise<CaptureApp[]> {
  if (process.platform === 'win32') return [];
  const list = await runHelper<PulseStream[]>(['list']);
  const grouped = new Map<string, CaptureApp>();
  for (const stream of list) {
    if (stream.pid <= 0 || !stream.name || isPhanteon(stream)) continue;
    const id = `${stream.pid}:${stream.name}`;
    if (!grouped.has(id)) grouped.set(id, { id, name: stream.name, pid: stream.pid, binary: stream.binary });
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isPhanteon(app: Pick<CaptureApp, 'name' | 'binary' | 'pid'>): boolean {
  return app.pid === process.pid || /phanteon/i.test(`${app.name} ${app.binary}`);
}

function ensureOwner(event: Electron.IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) throw new Error('Origem IPC inválida.');
}

export function registerAudioCapture(): void {
  ipcMain.handle(IPC.audioCaptureSupport, async (event) => {
    ensureOwner(event);
    return audioCaptureSupport();
  });
  ipcMain.handle(IPC.listAudioCaptureApps, async (event) => {
    ensureOwner(event);
    if (process.platform !== 'linux') return [];
    return listAudioCaptureApps();
  });
  ipcMain.handle(IPC.startAudioCapture, async (event, mode: CaptureMode, selected?: CaptureApp) => {
    const previous = starting;
    let release!: () => void;
    starting = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
    ensureOwner(event);
    if (process.platform !== 'linux' && process.platform !== 'win32') throw new Error('Captura de áudio não suportada nesta plataforma.');
    if (mode !== 'app' && mode !== 'desktop') throw new Error('Modo de captura inválido.');
    if (process.platform === 'win32' && mode !== 'desktop') throw new Error('Captura por aplicativo só é suportada no Linux.');
    if (active) await stopActive();
    let args: string[];
    if (mode === 'app') {
      if (!selected || !Number.isSafeInteger(selected.pid) || selected.pid <= 0 || !selected.name || isPhanteon(selected)) {
        throw new Error('Selecione um aplicativo de áudio válido; Phanteon não pode ser capturado.');
      }
      const fresh = await runHelper<PulseStream[]>(['list']);
      const exists = fresh.some((stream) => stream.pid === selected.pid && stream.name === selected.name && !isPhanteon(stream));
      if (!exists) throw new Error('O aplicativo selecionado não tem um stream de áudio ativo.');
      args = ['capture-app', String(selected.pid), selected.name];
    } else args = ['capture-desktop'];

    const child = spawn(helperPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const { port1, port2 } = new MessageChannelMain();
    active = { child, owner: event.sender, port: port1 };
    let stderr = '';
    let pcmCarry = Buffer.alloc(0);
    let bytesInWindow = 0;
    let windowStarted = Date.now();
    child.stdout.on('data', (chunk: Buffer) => {
      const aligned = pcmCarry.length ? Buffer.concat([pcmCarry, chunk]) : chunk;
      const alignedLength = aligned.length - (aligned.length % 8);
      pcmCarry = Buffer.from(aligned.subarray(alignedLength));
      const pcm = aligned.subarray(0, alignedLength);
      if (pcm.length === 0) return;
      const now = Date.now();
      if (now - windowStarted >= 1000) { windowStarted = now; bytesInWindow = 0; }
      bytesInWindow += pcm.byteLength;
      if (bytesInWindow > MAX_PCM_BYTES_PER_SECOND) {
        event.sender.send(IPC.audioCaptureError, 'A captura excedeu o limite de dados por segundo.');
        void stopActive();
        return;
      }
      const copy = Uint8Array.from(pcm);
      try { port1.postMessage({ pcm: copy.buffer }); }
      catch { void stopActive(); }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = appendStderr(stderr, chunk); });
    child.once('error', (error) => {
      event.sender.send(IPC.audioCaptureError, error.message);
      void stopActive();
    });
    child.once('close', (code) => {
      if (active?.child !== child) return;
      if (code !== 0 && !event.sender.isDestroyed()) event.sender.send(IPC.audioCaptureError, stderr.trim() || `Helper de captura encerrou (${code}).`);
      void stopActive();
    });
    event.sender.once('destroyed', () => { if (active?.child === child) void stopActive(); });
    event.sender.postMessage(IPC.audioCapturePort, null, [port2]);
    } finally {
      release();
    }
  });
  ipcMain.handle(IPC.stopAudioCapture, async (event) => {
    ensureOwner(event);
    await starting;
    if (active?.owner === event.sender) await stopActive();
  });
  app.on('before-quit', () => { void starting.then(stopActive); });
}

async function stopActive(): Promise<void> {
  const session = active;
  if (!session) return;
  active = null;
  session.port.close();
  if (session.child.exitCode === null && session.child.signalCode === null) {
    session.child.kill('SIGTERM');
    await new Promise<void>((resolve) => session.child.once('close', () => resolve()));
  }
}
