import { useMemo } from 'react';
import { chairOf } from '../model/catalogue';
import { checkClearances } from '../model/clearance';
import { useStore } from '../model/store';
import type { LayoutKey } from '../model/types';

/** Clearance checks for a layout with the current wheelchair (recomputed when either changes). */
export const useClearances = (key: LayoutKey) => {
  const layout = useStore((s) => s.project.layouts[key]);
  const act = useStore((s) => s.project.activity);
  const C = chairOf(act);
  return useMemo(() => checkClearances(layout, C), [layout, C.width, C.turn]); // eslint-disable-line react-hooks/exhaustive-deps
};
