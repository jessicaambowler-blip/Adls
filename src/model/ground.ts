import { itemToLocal } from './geometry';
import type { Item, Layout, SurfaceKind, Vec2 } from './types';

// Heights outside the house: the ground can sit lower than the floor (e.g. a low-set house 150 mm
// up), and ramps lead from the ground up to a door.

export const SURFACES: { id: SurfaceKind; label: string; rough: boolean; colour: string }[] = [
  { id: 'lawn', label: 'Lawn', rough: true, colour: '#7fa35a' },
  { id: 'pavers', label: 'Pavers', rough: false, colour: '#c8b8a2' },
  { id: 'concrete', label: 'Concrete', rough: false, colour: '#cfcbc3' },
  { id: 'gravel', label: 'Gravel', rough: true, colour: '#b7aea0' },
  { id: 'decking', label: 'Decking', rough: false, colour: '#a87b52' },
];
export const surfaceInfo = (s?: SurfaceKind) => SURFACES.find((x) => x.id === s) ?? SURFACES[0];

/** The rectangle the walls enclose (the house). */
export const houseBounds = (l: Layout) => {
  if (!l.walls.length) return null;
  const xs = l.walls.flatMap((w) => [w.a.x, w.b.x]), ys = l.walls.flatMap((w) => [w.a.y, w.b.y]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

export const isInside = (l: Layout, p: Vec2) => {
  const b = houseBounds(l);
  return !!b && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1;
};

/** Height (mm) things stand on at p: the floor inside, the ground outside (ramps not included). */
export const floorAt = (l: Layout, p: Vec2) => (isInside(l, p) ? 0 : l.ground ?? 0);

/** Height (mm) of a ramp's surface at local depth z (local +y is the bottom, rising towards -y). */
export const rampSurface = (it: Item, z: number) => {
  const r = it.ramp;
  if (!r) return 0;
  const top = -it.d / 2 + Math.min(it.d, r.landing);
  if (z <= top) return r.rise;
  return Math.max(0, (r.rise * (it.d / 2 - z)) / Math.max(1, it.d / 2 - top));
};

/** Height (mm) a wheelchair is at p: floor or ground, or on a ramp. */
export const groundAt = (l: Layout, p: Vec2) => {
  let h = floorAt(l, p);
  for (const it of l.items) {
    if (it.kind !== 'ramp' && it.kind !== 'step') continue;
    const q = itemToLocal(it, p);
    if (Math.abs(q.x) > it.w / 2 || Math.abs(q.y) > it.d / 2) continue;
    h = Math.max(h, floorAt(l, it) + (it.kind === 'step' ? it.h : rampSurface(it, q.y)));
  }
  return h;
};
