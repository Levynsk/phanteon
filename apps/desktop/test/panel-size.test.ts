import { describe, expect, test } from 'bun:test';
import { clampPanelWidth, resizePanelWidth } from '../src/lib/panel-size';
import { clampPanelWidth as clampStoredWidth, PANEL_WIDTH } from '../src/app/stores/ui';

describe('panel resize drag', () => {
  test('dragging the edge left widens a right-hand panel', () => {
    expect(resizePanelWidth(300, -40, 200, 640)).toBe(340);
  });

  test('dragging right narrows it, never below the minimum', () => {
    expect(resizePanelWidth(300, 40, 200, 640)).toBe(260);
    expect(resizePanelWidth(220, 200, 200, 640)).toBe(200);
  });

  test('the maximum is a hard stop', () => {
    expect(resizePanelWidth(600, -400, 200, 640)).toBe(640);
  });

  test('a window narrower than the cap shrinks the maximum instead of overflowing', () => {
    expect(clampPanelWidth(640, 800)).toBe(480);
    expect(clampPanelWidth(640, 1600)).toBe(640);
  });
});

describe('stored panel widths', () => {
  test('member list stays within its bounds', () => {
    expect(clampStoredWidth('members', 50)).toBe(PANEL_WIDTH.members.min);
    expect(clampStoredWidth('members', 9999)).toBe(PANEL_WIDTH.members.max);
  });

  test('voice chat starts wide enough to read and has room to grow', () => {
    expect(PANEL_WIDTH['voice-chat'].initial).toBe(340);
    expect(PANEL_WIDTH['voice-chat'].max).toBeGreaterThan(500);
  });
});
