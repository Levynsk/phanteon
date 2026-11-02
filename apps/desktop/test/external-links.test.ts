import { describe, expect, test } from 'bun:test';
import { isExternalLinkAllowed } from '../electron/external-links';

describe('external link policy', () => {
  test('web links are handed to the browser', () => {
    expect(isExternalLinkAllowed('https://example.com/path?q=1')).toBe(true);
    expect(isExternalLinkAllowed('http://localhost:5173/')).toBe(true);
  });

  test('local files and custom protocol handlers are refused', () => {
    // these reached shell.openExternal before the window-level handler was fixed
    expect(isExternalLinkAllowed('file:///etc/passwd')).toBe(false);
    expect(isExternalLinkAllowed('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isExternalLinkAllowed('smb://attacker/share')).toBe(false);
    expect(isExternalLinkAllowed('javascript:alert(1)')).toBe(false);
    expect(isExternalLinkAllowed('discord://-/channels/1/2')).toBe(false);
  });

  test('garbage is refused instead of thrown at the shell', () => {
    expect(isExternalLinkAllowed('')).toBe(false);
    expect(isExternalLinkAllowed('not a url')).toBe(false);
  });
});
