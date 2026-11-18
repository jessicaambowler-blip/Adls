import { useMemo } from 'react';
import { chairOf } from '../model/catalogue';
import { checkClearances, type Check } from '../model/clearance';
import { useStore } from '../model/store';
import type { Layout, LayoutKey } from '../model/types';
import { useSettledLayout } from './settled';

// shared between the plan, 3D view, activity panel and summary (one search per layout and chair size)
const cache = new WeakMap<Layout, Map<string, Check[]>>();

/** Clearance checks for a layout with the current wheelchair (recomputed when either changes). */
export const useClearances = (key: LayoutKey) => {
  const layout = useSettledLayout(key);
  const act = useStore((s) => s.project.activity);
  const C = chairOf(act);
  return useMemo(() => {
    const k = `${C.width}:${C.turn}`;
    let m = cache.get(layout);
    if (!m) cache.set(layout, (m = new Map()));
    let r = m.get(k);
    if (!r) m.set(k, (r = checkClearances(layout, C)));
    return r;
  }, [layout, C.width, C.turn]); // eslint-disable-line react-hooks/exhaustive-deps
};
