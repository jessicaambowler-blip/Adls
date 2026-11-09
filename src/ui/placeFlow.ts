import { applyBathroomTemplate, itemAt, openingAt } from '../model/place';
import { useStore } from '../model/store';
import type { Item, LayoutKey, Opening, Vec2 } from '../model/types';
import { notify } from './dialogs';

/** What the Place tool would put down at p (for the preview under the pointer). */
export const previewAt = (key: LayoutKey, p: Vec2): { item?: Item; opening?: Opening } => {
  const st = useStore.getState();
  const pl = st.placing;
  const l = st.project.layouts[key];
  if (!pl) return {};
  if (pl.what === 'item') return { item: itemAt(l, pl.kind, p, pl.over) };
  if (pl.what === 'opening') return { opening: openingAt(l, pl.kind, p, pl.width) ?? undefined };
  return {};
};

/** Put down whatever is waiting to be placed, at p (plan mm). */
export const placeAt = (key: LayoutKey, p: Vec2) => {
  const st = useStore.getState();
  const pl = st.placing;
  if (!pl) return;
  const g = Math.max(1, st.gridMm);
  const q = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  if (pl.what === 'item') {
    const it = itemAt(st.project.layouts[key], pl.kind, q, pl.over);
    st.updateLayout((l) => { l.items.push(it); }, { key });
    st.set({ tool: 'select', placing: undefined, selection: { type: 'item', id: it.id } });
  } else if (pl.what === 'opening') {
    const o = openingAt(st.project.layouts[key], pl.kind, p, pl.width);
    if (!o) { notify('Click on (or right next to) a wall to put it there.'); return; }
    st.updateLayout((l) => { l.openings.push(o); }, { key });
    st.set({ tool: 'select', placing: undefined, selection: { type: 'opening', id: o.id } });
  } else {
    let msg = '';
    st.updateLayout((l) => { msg = applyBathroomTemplate(l, pl.id, p); }, { key });
    st.set({ tool: 'select', placing: undefined, selection: null });
    if (msg) notify(msg);
  }
};
