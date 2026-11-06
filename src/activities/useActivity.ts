import { useMemo } from 'react';
import { useStore } from '../model/store';
import type { LayoutKey } from '../model/types';
import { ASSETS } from '../three/assets';
import { buildActivity, type BuiltActivity } from './activities';

/** Build (and cache) the activity timeline for one layout. Rebuilt whenever the layout changes. */
export const useActivity = (key: LayoutKey): BuiltActivity => {
  const layout = useStore((s) => s.project.layouts[key]);
  const settings = useStore((s) => s.project.activity);
  const assetVersion = useStore((s) => s.assetVersion);
  return useMemo(() => {
    let importedDuration = 0;
    if (settings.type === 'imported') {
      const it = layout.items.find((i) => i.id === settings.importedItemId) ?? layout.items.find((i) => i.kind === 'imported');
      const a = it?.assetId ? ASSETS.get(it.assetId) : undefined;
      importedDuration = a?.clips[0]?.duration ?? 0;
    }
    return buildActivity(layout, settings, importedDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, settings, assetVersion]);
};
