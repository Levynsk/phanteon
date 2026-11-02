/**
 * Only web links may leave the app. The window-level handler in `window.ts` used to
 * forward every scheme to `shell.openExternal`, which let message content launch a
 * local file or a custom protocol handler.
 */
export function isExternalLinkAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
