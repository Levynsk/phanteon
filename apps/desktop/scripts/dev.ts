import { spawn } from 'node:child_process';

const API_URL = process.env.API_URL ?? 'http://localhost:3010';
const RENDERER_URL = 'http://localhost:5273';

const bin = (name: string) => `node_modules/.bin/${name}`;

async function buildElectron(): Promise<void> {
  await run('bun', [
    'build',
    'electron/main.ts',
    'electron/preload.ts',
    'electron/display-picker-preload.ts',
    '--outdir',
    'dist-electron',
    '--target',
    'node',
    '--external',
    'electron',
    '--format',
    'esm',
  ]);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

await buildElectron();

const vite = spawn(bin('vite'), [], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

await waitForServer(RENDERER_URL);

let electron: ReturnType<typeof spawn> | null = null;
let restarting = false;

function startElectron(): void {
  electron = spawn(bin('electron'), ['dist-electron/main.js'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL, API_URL },
  });
  electron.on('exit', (code) => {
    if (restarting) return;
    vite.kill();
    process.exit(code ?? 0);
  });
}

startElectron();

const watcher = Bun.spawn(['bun', 'build', '--watch', 'electron/main.ts', 'electron/preload.ts', 'electron/display-picker-preload.ts',
    '--outdir', 'dist-electron', '--target', 'node', '--external', 'electron', '--format', 'esm'], {
  stdout: 'pipe',
  stderr: 'inherit',
});

for await (const chunk of watcher.stdout) {
  const text = new TextDecoder().decode(chunk);
  if (text.includes('built') && electron) {
    restarting = true;
    electron.removeAllListeners('exit');
    electron.kill();
    startElectron();
    restarting = false;
  }
}

async function waitForServer(url: string, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await Bun.sleep(250);
    }
  }
  throw new Error(`Renderer dev server not reachable at ${url}`);
}
