import { CHAIRS } from '../model/catalogue';
import { detectPlan } from '../model/detect';
import { add, layoutBounds, layoutCentre, mul, uid, wallNormal, wallPoint } from '../model/geometry';
import { exploreFrom } from '../model/pathfinding';
import { useStore } from '../model/store';
import type { Layout, LayoutKey, Opening, Vec2, Wall } from '../model/types';
import type { PlanPixels } from '../model/planSnap';
import { notify } from './dialogs';

const MAX_SIDE = 3400; // detection works on at most this many pixels per side (accuracy holds, memory stays low)

/**
 * Read the plan as greyscale, shrinking big images by a whole factor. The image is read in tiles so a
 * very large plan never needs a full-size canvas, and each shrunk pixel keeps half of its darkest
 * source pixel so thin CAD lines do not fade away.
 */
const loadGray = (src: string) =>
  new Promise<{ gray: Uint8Array; W: number; H: number; factor: number }>((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const f = Math.max(1, Math.ceil(Math.max(w, h) / MAX_SIDE));
      const W = Math.floor(w / f), H = Math.floor(h / f);
      const gray = new Uint8Array(W * H);
      const T = f * 512;
      const c = document.createElement('canvas');
      c.width = T; c.height = T;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      for (let ty = 0; ty < H; ty += 512) for (let tx = 0; tx < W; tx += 512) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, T, T);
        ctx.drawImage(img, tx * f, ty * f, T, T, 0, 0, T, T);
        const d = ctx.getImageData(0, 0, T, T).data;
        const bw = Math.min(512, W - tx), bh = Math.min(512, H - ty);
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
          let sum = 0, mn = 255;
          for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
            const i = ((y * f + dy) * T + x * f + dx) * 4;
            const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            sum += v; if (v < mn) mn = v;
          }
          gray[(ty + y) * W + tx + x] = f === 1 ? mn : (sum / (f * f) + mn) / 2;
        }
      }
      res({ gray, W, H, factor: f });
    };
    img.onerror = () => rej(new Error('image could not be read'));
    img.src = src;
  });

const r10 = (v: number) => Math.round(v / 10) * 10;

// The plan's pixels, read once per uploaded image (for snapping while tracing and for detection).
const grayCache = new Map<string, Promise<{ gray: Uint8Array; W: number; H: number; factor: number }>>();
const grayOf = (dataUrl: string) => {
  let p = grayCache.get(dataUrl);
  if (!p) { p = loadGray(dataUrl); grayCache.set(dataUrl, p); }
  return p;
};

/** The background plan's pixels in plan millimetres (for snapping to its drawn walls). */
export const planPixels = async (bg: NonNullable<Layout['background']>): Promise<PlanPixels> => {
  const { gray, W, H, factor } = await grayOf(bg.dataUrl);
  return { gray, W, H, k: bg.scale * factor, x0: bg.x, y0: bg.y };
};

/** Run detection over the whole uploaded plan. */
export const detectWholePlan = (key: LayoutKey) => {
  const bg = useStore.getState().project.layouts[key].background;
  if (!bg) return;
  return runDetection(key, { x: bg.x, y: bg.y }, { x: bg.x + bg.pxWidth * bg.scale, y: bg.y + bg.pxHeight * bg.scale });
};

/** Run wall detection inside a rectangle (plan mm) on the layout's background plan. */
export const runDetection = async (key: LayoutKey, a: Vec2, b: Vec2) => {
  const st = useStore.getState();
  const bg = st.project.layouts[key].background;
  if (!bg) return;
  st.set({ detecting: true });
  try {
    const { gray, W, H, factor } = await grayOf(bg.dataUrl);
    const k = bg.scale * factor; // mm per detection pixel
    const toPx = (p: Vec2) => ({ x: (p.x - bg.x) / k, y: (p.y - bg.y) / k });
    const pa = toPx(a), pb = toPx(b);
    const rect = { x0: Math.min(pa.x, pb.x), y0: Math.min(pa.y, pb.y), x1: Math.max(pa.x, pb.x), y1: Math.max(pa.y, pb.y) };
    const res = detectPlan(gray, W, H, { mmPerPx: k, rect });
    const toMm = (p: { x: number; y: number }): Vec2 => ({ x: Math.round(bg.x + p.x * k), y: Math.round(bg.y + p.y * k) });
    const walls: Wall[] = res.walls.map((w) => ({
      id: uid('wall'), a: toMm(w.a), b: toMm(w.b),
      thickness: Math.max(90, Math.min(300, r10(w.thicknessPx * k))),
    }));
    const openings: Opening[] = res.openings.map((o) => {
      const width = r10(o.widthPx * k);
      const isDouble = o.kind === 'door' && width > 1300;
      return {
        id: uid('open'), wallId: walls[o.wall].id,
        kind: o.kind === 'window' ? 'window' : isDouble ? 'opening' : o.kind,
        offset: Math.round(o.offsetPx * k), width,
        height: o.kind === 'window' ? 1200 : 2040, sill: o.kind === 'window' ? 900 : 0,
        swingSide: o.swingSide, hinge: o.hinge,
      };
    });
    if (walls.length < 3) {
      st.set({ detecting: false, tool: 'select' });
      notify('Not enough walls were found in that area. Check the plan’s scale, try a box around just one floor, or trace the walls by hand with the Walls tool – it snaps to the walls drawn on the plan.');
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
