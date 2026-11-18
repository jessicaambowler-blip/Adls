import { useRef } from 'react';
import { useStore } from '../model/store';
import type { Layout, LayoutKey } from '../model/types';

/**
 * The layout as it was when nothing was being dragged. Routes and clearance checks follow this, so a
 * drag (dozens of updates a second) moves walls and furniture smoothly and the slower checks run once,
 * when it is let go.
 */
export const useSettledLayout = (key: LayoutKey): Layout => {
  const live = useStore((s) => s.project.layouts[key]);
  const busy = useStore((s) => !!s.dragging || !!s.dragging3d);
  const last = useRef(live);
  if (!busy) last.current = live;
  return last.current;
};
