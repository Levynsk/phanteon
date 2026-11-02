import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollEdges {
  /** Content continues above / below the viewport. */
  top: boolean;
  bottom: boolean;
  ref: (node: HTMLElement | null) => void;
  /** Re-measures after content or layout changes. */
  measure: () => void;
}

/**
 * Tracks whether a scroll container has hidden content on either edge, so
 * panels can fade their headers and tab bars like Discord does.
 */
export function useScrollEdges(deps: unknown[] = []): ScrollEdges {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const frame = useRef(0);

  const measure = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!node) return;
      const atTop = node.scrollTop <= 2;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
      setEdges((current) =>
        current.top === !atTop && current.bottom === !atBottom ? current : { top: !atTop, bottom: !atBottom },
      );
    });
  }, [node]);

  useEffect(() => {
    if (!node) return;
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [node, measure]);

  // content changed → the edges may have moved
  useEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  const ref = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);

  return { top: edges.top, bottom: edges.bottom, ref, measure };
}
