import { app, BrowserWindow, protocol, shell } from 'electron';
import { is, resolveRendererTarget } from './env';
import { isExternalLinkAllowed } from './external-links';
import { registerIpc } from './ipc';
import { resolveApiBaseUrl } from './ipc/app';
import { createMainWindow, focusMainWindow } from './window';
import { autoGrantPermissions } from './permissions';
import { registerDisplayCapture } from './display-capture';

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.setAppUserModelId('com.phanteon.desktop');

/**
 * Electron only lets a page load `<video>`/`<audio>` from a secure, standard
 * scheme. Uploads live on the plain-HTTP API, so media goes through
 * `remote://<host>/...`, which this handler forwards to the real API.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'remote',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

app.on('second-instance', (_event, argv) => {
  focusMainWindow();
  forwardDeepLinks(argv);
});

/**
 * Origin the renderer page is loaded from (`file://` when packaged, the dev server URL
 * otherwise). Responses proxied for it must allow exactly this value.
 */
function originOf(request: Request): string {
  const initiator = request.headers.get('referer');
  if (initiator) {
    try {
      const { origin } = new URL(initiator);
      if (origin && origin !== 'null') return origin;
    } catch {
      // fall through to the app's own URL
    }
  }
  const target = resolveRendererTarget();
  return 'url' in target ? new URL(target.url).origin : 'file://';
}

app.whenReady().then(() => {
  const apiBase = resolveApiBaseUrl();
  protocol.handle('remote', async (request) => {
    // `remote` is a standard scheme, so its URLs parse like `https` and a port would be
    // dropped. The renderer therefore encodes `host_port` in the host; it is restored here.
    const target = new URL(request.url);
    const [targetHost, targetPort] = target.hostname.split('_');
    if (!/^https?:\/\/[^/]+$/.test(apiBase)) {
      return new Response('Not found', { status: 404 });
    }
    const api = new URL(apiBase);
    // a plain-HTTP API is only trusted for its own origin; HTTPS may fetch other hosts (media)
    const apiHost = [api.hostname, api.port].filter(Boolean).join('_');
    if (api.protocol === 'http:' && target.hostname !== apiHost) {
      return new Response('Not found', { status: 404 });
    }
    // the renderer cannot attach headers to <img>/<video>, so the session token rides in
    // `access_token` and only becomes an Authorization header here, on the way out
    const accessToken = target.searchParams.get('access_token');
    if (accessToken) target.searchParams.delete('access_token');
    const targetPath = `${target.pathname}${target.search}`;
    const targetOrigin = [targetHost, targetPort].filter(Boolean).join(':');
    const upstream =
      target.hostname === apiHost ? new URL(targetPath, apiBase) : new URL(`${target.protocol}//${targetOrigin}${targetPath}`);

    // keep Range so video players can seek; media URLs are GET-only
    const headers = new Headers();
    const range = request.headers.get('range');
    if (range) headers.set('range', range);
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    // `remote://` is not a valid Origin, so the upstream cannot reflect this page; the
    // response is rewritten to allow it below
    headers.set('origin', originOf(request));
    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
    const response = await fetch(upstream, { method, headers, body });

    // the page reads this from `origin`, which the upstream never sees: `remote://` is not a
    // valid Origin header. `corsEnabled: true` makes Chromium CORS-check images too, so the
    // response must allow the exact page origin — a reflected upstream origin does not match.
    const out = new Headers(response.headers);
    out.set('access-control-allow-origin', originOf(request));
    if (!out.has('access-control-expose-headers')) {
      out.set('access-control-expose-headers', 'Content-Range, Accept-Ranges, Content-Length, Content-Disposition');
    }
    out.delete('access-control-allow-credentials');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
  });

  registerIpc();
  autoGrantPermissions();
  registerDisplayCapture();
  createMainWindow();
  forwardDeepLinks(process.argv);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalLinkAllowed(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const allowed = is.dev ? url.startsWith('http://localhost:') : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
});

function forwardDeepLinks(argv: string[]): void {
  const link = argv.find((arg) => arg.startsWith('phanteon://'));
  if (!link) return;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app:deep-link', link);
}

if (is.dev) {
  console.log(`[main] API base URL: ${resolveApiBaseUrl()}`);
}
