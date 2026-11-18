import { useMemo } from 'react';
import { useStore } from '../model/store';
import type { ActivitySettings, Layout, LayoutKey } from '../model/types';
import { ASSETS } from '../three/assets';
import { buildActivity, type BuiltActivity } from './activities';
import { useSettledLayout } from './settled';

// One result per layout, shared by every panel that shows it (plan, 3D, timeline, activity panel,
// summary): planning a route takes ~0.1 s, so working it out separately for each would be slow.
const cache = new WeakMap<Layout, { settings: ActivitySettings; assetVersion: number; built: BuiltActivity }>();

const build = (layout: Layout, settings: ActivitySettings, assetVersion: number) => {
  const hit = cache.get(layout);
  if (hit && hit.settings === settings && hit.assetVersion === assetVersion) return hit.built;
  let importedDuration = 0;
  if (settings.type === 'imported') {
    const it = layout.items.find((i) => i.id === settings.importedItemId) ?? layout.items.find((i) => i.kind === 'imported');
    const a = it?.assetId ? ASSETS.get(it.assetId) : undefined;
    importedDuration = a?.clips[0]?.duration ?? 0;
  }
  const built = buildActivity(layout, settings, importedDuration);
  cache.set(layout, { settings, assetVersion, built });
  return built;
};

/** The activity timeline for one layout (rebuilt when the layout settles after a change). */
export const useActivity = (key: LayoutKey): BuiltActivity => {
  const layout = useSettledLayout(key);
  const settings = useStore((s) => s.project.activity);
  const assetVersion = useStore((s) => s.assetVersion);
  return useMemo(() => build(layout, settings, assetVersion), [layout, settings, assetVersion]);
};
