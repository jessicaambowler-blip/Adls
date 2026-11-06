import { CHAIRS } from '../model/catalogue';
import { detectPlan, toGray } from '../model/detect';
import { add, layoutBounds, layoutCentre, mul, uid, wallNormal, wallPoint } from '../model/geometry';
import { exploreFrom } from '../model/pathfinding';
import { useStore } from '../model/store';
import type { LayoutKey, Opening, Vec2, Wall } from '../model/types';
import { notify } from './dialogs';

const loadPixels = (src: string) =>
  new Promise<ImageData>((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      res(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = () => rej(new Error('image could not be read'));
    img.src = src;
  });

const r10 = (v: number) => Math.round(v / 10) * 10;

/** Run wall detection inside a rectangle (plan mm) on the layout's background plan. */
export const runDetection = async (key: LayoutKey, a: Vec2, b: Vec2) => {
  const st = useStore.getState();
  const bg = st.project.layouts[key].background;
  if (!bg) return;
  st.set({ detecting: true });
  try {
    const img = await loadPixels(bg.dataUrl);
    const toPx = (p: Vec2) => ({ x: (p.x - bg.x) / bg.scale, y: (p.y - bg.y) / bg.scale });
    const pa = toPx(a), pb = toPx(b);
    const rect = { x0: Math.min(pa.x, pb.x), y0: Math.min(pa.y, pb.y), x1: Math.max(pa.x, pb.x), y1: Math.max(pa.y, pb.y) };
    const res = detectPlan(toGray(img), img.width, img.height, { mmPerPx: bg.scale, rect });
    const toMm = (p: { x: number; y: number }): Vec2 => ({ x: Math.round(bg.x + p.x * bg.scale), y: Math.round(bg.y + p.y * bg.scale) });
    const walls: Wall[] = res.walls.map((w) => ({
      id: uid('wall'), a: toMm(w.a), b: toMm(w.b),
      thickness: Math.max(90, Math.min(300, r10(w.thicknessPx * bg.scale))),
    }));
    const openings: Opening[] = res.openings.map((o) => {
      const width = r10(o.widthPx * bg.scale);
      const isDouble = o.kind === 'door' && width > 1300;
      return {
        id: uid('open'), wallId: walls[o.wall].id,
        kind: o.kind === 'window' ? 'window' : isDouble ? 'opening' : o.kind,
        offset: Math.round(o.offsetPx * bg.scale), width,
        height: o.kind === 'window' ? 1200 : 2040, sill: o.kind === 'window' ? 900 : 0,
        swingSide: o.swingSide, hinge: o.hinge,
      };
    });
    if (walls.length < 3) {
      st.set({ detecting: false, tool: 'select' });
      notify('Not enough walls were found in that area. Try drawing the box more tightly around one floor, or check the plan scale. You can always trace the walls with “Draw room outline”.');
      return;
    }
    const counts = {
      walls: walls.length,
      doors: openings.filter((o) => o.kind === 'door').length,
      windows: openings.filter((o) => o.kind === 'window').length,
      openings: openings.filter((o) => o.kind === 'opening').length,
    };
    useStore.getState().set({ detection: { walls, openings, counts, layoutKey: key }, detecting: false, tool: 'select', selection: null, panel: 'room' });
  } catch (e) {
    st.set({ detecting: false, tool: 'select' });
    notify(`Wall detection did not work on this plan (${(e as Error).message}).`);
  }
};

/** Replace the layout's walls with the reviewed proposal. */
export const acceptDetection = (removeFurniture: boolean) => {
  const st = useStore.getState();
  const d = st.detection;
  if (!d) return;
  st.updateLayout((l) => {
    l.walls = d.walls;
    l.openings = d.openings;
    if (removeFurniture) { l.items = []; l.targetItemId = undefined; }
    l.unverified = true;
    // start outside an exterior door if there is one, otherwise below the plan
    const b = layoutBounds({ ...l, items: [] });
    const c = layoutCentre({ ...l, items: [] });
    // try each exterior doorway and keep the first one with a real route to the middle of the house
    const candidates: { start: Vec2 & { heading: number } }[] = [];
    for (const o of d.openings) {
      if (o.kind === 'window' || o.width < CHAIRS.manual.width + 60) continue;
      const w = d.walls.find((x) => x.id === o.wallId)!;
      const p = wallPoint(w, o.offset);
      let n = wallNormal(w);
      if ((c.x - p.x) * n.x + (c.y - p.y) * n.y > 0) n = mul(n, -1); // n points away from the middle
      const edge = Math.min(p.x - b.minX, b.maxX - p.x, p.y - b.minY, b.maxY - p.y);
      if (edge > 1500) continue; // not on the outside of the house
      const s = add(p, mul(n, 900));
      candidates.push({ start: { x: Math.round(s.x), y: Math.round(s.y), heading: Math.round(Math.atan2(n.x, -n.y) * (180 / Math.PI)) } });
    }
    const found = exploreFrom(l, candidates.map((c) => c.start), CHAIRS.manual.width);
    const chosen = found?.start ?? null;
    const chosenEnd = found ? { x: Math.round(found.goal.x), y: Math.round(found.goal.y) } : { x: Math.round(c.x), y: Math.round(c.y) };
    l.start = chosen ?? { x: Math.round(c.x), y: Math.round(b.maxY + 900), heading: 180 };
    l.end = chosenEnd;
  }, { key: d.layoutKey });
  // activities that need a bed/toilet cannot run once the furniture is removed
  if (removeFurniture && st.project.activity.type !== 'navigate') st.updateActivity({ type: 'navigate' });
  st.set({ detection: undefined, selection: null, time: 0, playing: false });
};
