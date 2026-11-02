import { session, type Session } from 'electron';
import { is } from './env';

/** Permissions the app legitimately needs; anything else keeps Electron's default (denied). */
const AUTO_GRANTED = new Set([
  'media',
  'display-capture',
  'speaker-selection',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
]);

/**
 * Grants the app's own windows the microphone/camera without a prompt: a chat
 * client asks on every join, so the dialog is pure noise. Only the app's own
 * origins are trusted, so a page that ended up in the window cannot grab a device.
 */
export function autoGrantPermissions(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!AUTO_GRANTED.has(permission)) {
      callback(false);
      return;
    }
    callback(isAppUrl(contents.getURL() || details.requestingUrl));
  });

  // keeps the persisted status in agreement with the request handler
  target.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    AUTO_GRANTED.has(permission) && isAppUrl(requestingOrigin),
  );
}

/** The packaged app loads from `file://`; the dev build from the Vite server. */
function isAppUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  return is.dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
}
