/** Channel the share picker page uses to report the chosen source (or null on cancel). */
export const DISPLAY_PICK_CHANNEL = 'display-pick:choose';

/** What the picker sends back: which source, and at which quality to capture it. */
export interface DisplayPickChoice {
  id: string;
  height: number;
  frameRate: number;
  audioMode: 'app' | 'desktop';
  audioApp: string;
}
