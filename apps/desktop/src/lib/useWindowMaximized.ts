import { useEffect, useState } from 'react';

/** Tracks the Electron window's maximized state so the control glyph can swap. */
export function useWindowMaximized(): boolean {
  const desktop = window.desktop;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void desktop.window.isMaximized().then(setMaximized);
    return desktop.window.onMaximizedChange(setMaximized);
  }, [desktop]);

  return maximized;
}
