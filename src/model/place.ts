import { catalogueEntry } from './catalogue';
import { add, headingOf, mul, nearestWall, rotate, uid, wallLength, wallNormal, wallPoint } from './geometry';
import { makeItem } from './templates';
import type { Item, ItemKind, Layout, Opening, Vec2 } from './types';

// Putting things where an OT would put them: wall-mounted items flush against the nearest wall,
// doors and windows into the wall clicked, bathroom templates into the room clicked.

/** directions of an item: its front (local +y), its side (local +x) */
const front = (it: Item) => rotate({ x: 0, y: 1 }, it.rotation);
const side = (it: Item) => rotate({ x: 1, y: 0 }, it.rotation);

/** The wall side facing p: the wall, the point on its surface, and the direction into the room. */
export const wallFace = (l: Layout, p: Vec2) => {
  const nw = nearestWall(l, p);
  if (!nw) return null;
  let n = wallNormal(nw.wall);
  if ((p.x - nw.point.x) * n.x + (p.y - nw.point.y) * n.y < 0) n = mul(n, -1);
  return { ...nw, n, surface: add(nw.point, mul(n, nw.wall.thickness / 2)) };
};

/** A new item at p; wall-mounted kinds go flush against the nearest wall (within 1.2 m), facing into the room. */
export const itemAt = (l: Layout, kind: ItemKind, p: Vec2, over: Partial<Item> = {}): Item => {
  const it = makeItem(kind, Math.round(p.x), Math.round(p.y), 0, over);
  const cat = catalogueEntry(kind);
  const f = cat?.wallMounted ? wallFace(l, p) : null;
  if (f && f.distance < 1200) {
    // keep it along the wall, centred where clicked but inside the wall's ends
    const L = wallLength(f.wall);
    const t = Math.max(it.w / 2, Math.min(L - it.w / 2, f.t));
    const c = add(add(wallPoint(f.wall, t), mul(f.n, f.wall.thickness / 2)), mul(f.n, it.d / 2));
    it.x = Math.round(c.x); it.y = Math.round(c.y);
    it.rotation = Math.round(headingOf(f.n));
  }
  return it;
};

/** A door/window/opening in the wall nearest p, centred where clicked. */
export const openingAt = (l: Layout, kind: Opening['kind'], p: Vec2, width?: number): Opening | null => {
  const nw = nearestWall(l, p);
  if (!nw || nw.distance > 1000) return null;
  const L = wallLength(nw.wall);
  const w = Math.min(width ?? (kind === 'window' ? 1200 : 870), L - 200);
  if (w < 300) return null;
  return {
    id: uid('open'), wallId: nw.wall.id, kind, width: w, offset: Math.round(Math.max(w / 2 + 50, Math.min(L - w / 2 - 50, nw.t))),
    height: kind === 'window' ? 1200 : 2040, sill: kind === 'window' ? 900 : 0, swingSide: 1, hinge: 'start',
  };
};

/** The rectangle of the room around p, found by looking for the nearest wall in each direction. */
export const roomAround = (l: Layout, p: Vec2) => {
  const hit = (d: Vec2) => {
    let best = Infinity;
    for (const w of l.walls) {
      // ray p + s·d against the wall's inner face line
      const a = w.a, e = { x: w.b.x - w.a.x, y: w.b.y - w.a.y };
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-9) continue;
      const ao = { x: a.x - p.x, y: a.y - p.y };
      const s = (ao.x * e.y - ao.y * e.x) / den, u = (ao.x * d.y - ao.y * d.x) / den;
      if (s > 0 && u >= -0.001 && u <= 1.001) best = Math.min(best, s - w.thickness / 2);
    }
    return best;
  };
  const r = hit({ x: 1, y: 0 }), lf = hit({ x: -1, y: 0 }), dn = hit({ x: 0, y: 1 }), up = hit({ x: 0, y: -1 });
  if (![r, lf, dn, up].every(Number.isFinite)) return null;
  return { x0: p.x - lf, x1: p.x + r, y0: p.y - up, y1: p.y + dn };
};

export interface BathroomTemplate { id: string; label: string; blurb: string; min: [number, number] }

export const BATHROOM_TEMPLATES: BathroomTemplate[] = [
  { id: 'accessible', label: 'Accessible shower room', blurb: 'Level-entry shower with a fold-down seat area and rail, toilet with L-shaped and side rails, wall basin with knee space.', min: [2100, 2300] },
  { id: 'bath-to-shower', label: 'Bath replaced by a level-entry shower', blurb: 'Keeps the toilet and basin where they are; replaces the bath with a level-entry shower and rails.', min: [1600, 1600] },
  { id: 'toilet-rails', label: 'Rails at the toilet', blurb: 'Adds an L-shaped rail beside the toilet and a horizontal rail on the back wall.', min: [800, 1000] },
];

const BATH_KINDS: ItemKind[] = ['toilet', 'basin', 'vanity', 'bath', 'shower', 'grab-rail', 'grab-rail-l', 'shower-commode'];

/**
 * Apply a bathroom template to the room around p. Returns a short description of what changed, or
 * an explanation when the room is too small.
 */
export const applyBathroomTemplate = (l: Layout, id: string, p: Vec2): string => {
  const r = roomAround(l, p);
  if (!r) return 'Click inside a room enclosed by walls.';
  const W = r.x1 - r.x0, D = r.y1 - r.y0;
  const tpl = BATHROOM_TEMPLATES.find((t) => t.id === id)!;
  const [mw, md] = tpl.min;
  if (Math.min(W, D) < Math.min(mw, md) || Math.max(W, D) < Math.max(mw, md)) return `This room is about ${Math.round(W)} × ${Math.round(D)} mm – the “${tpl.label}” layout needs at least ${mw} × ${md} mm.`;
  const inRoom = (it: Item) => it.x > r.x0 && it.x < r.x1 && it.y > r.y0 && it.y < r.y1;
  const at = (x: number, y: number): Vec2 => ({ x: r.x0 + x, y: r.y0 + y });
  const add2 = (it: Item) => l.items.push(it);
  if (id === 'toilet-rails') {
    const t = l.items.find((it) => it.kind === 'toilet' && inRoom(it));
    if (!t) return 'There is no toilet in this room yet.';
    // L rail on the side wall nearest the toilet, rail on the wall behind
    const near = [-1, 1].map((sg) => wallFace(l, add({ x: t.x, y: t.y }, mul(side(t), sg * 600)))).sort((a, b) => (a?.distance ?? 1e9) - (b?.distance ?? 1e9))[0];
    if (near) add2(itemAt(l, 'grab-rail-l', add(near.point, mul(near.n, 50)), {}));
    const back = wallFace(l, add({ x: t.x, y: t.y }, mul(front(t), -(t.d / 2 - 60))));
    if (back) add2(itemAt(l, 'grab-rail', add(back.point, mul(back.n, 50)), { w: 600 }));
    return 'Added an L-shaped rail beside the toilet and a rail behind it.';
  }
  const removed = l.items.filter((it) => inRoom(it) && (id === 'accessible' ? BATH_KINDS.includes(it.kind) : it.kind === 'bath'));
  if (id === 'bath-to-shower' && !removed.length) return 'There is no bath in this room to replace.';
  l.items = l.items.filter((it) => !removed.includes(it));
  if (id === 'bath-to-shower') {
    const b = removed[0];
    // the shower keeps the bath's back against the same wall and comes further into the room
    const w = Math.max(1160, b.w * 0.8), d = Math.max(1100, b.d * 1.4);
    const back = add({ x: b.x, y: b.y }, mul(front(b), -b.d / 2));
    const c = add(back, mul(front(b), d / 2));
    l.items.push(makeItem('shower', Math.round(c.x), Math.round(c.y), b.rotation, { w, d }));
    add2(itemAt(l, 'grab-rail', add(back, mul(front(b), 60)), { w: 900 }));
    return 'Replaced the bath with a level-entry shower and a rail.';
  }
  // accessible shower room laid out along the room's sides
  const wide = W >= D;
  const s = wide ? { a: at(650, 650), toilet: at(W - 250, D * 0.45), basin: at(W * 0.5, D - 250) } : { a: at(650, 650), toilet: at(W - 250, D - 900), basin: at(250, D * 0.55) };
  add2(makeItem('shower', s.a.x, s.a.y, 0, { w: 1300, d: 1300 }));
  add2(itemAt(l, 'grab-rail', at(30, 650), { w: 900 }));
  add2(itemAt(l, 'toilet', s.toilet));
  const t = l.items[l.items.length - 1];
  add2(itemAt(l, 'grab-rail-l', add({ x: t.x, y: t.y }, { x: 0, y: -500 })));
  add2(itemAt(l, 'basin', s.basin));
  return `Laid out an accessible shower room (${Math.round(W)} × ${Math.round(D)} mm). Check the circulation space and adjust as needed.`;
};

/** Length of a ramp from its rise, gradient and top landing (mm). */
export const rampLength = (r: NonNullable<Item['ramp']>) => Math.round(r.rise * r.gradient + r.landing);

/** A plain-language check of a ramp against common guidance (AS 1428.1 style); not a compliance test. */
export const rampNote = (r: NonNullable<Item['ramp']>) => {
  const run = r.rise * r.gradient;
  if (r.rise <= 35 && r.gradient >= 8) return 'Threshold ramp (rise up to 35 mm, 1:8 or gentler).';
  if (r.rise <= 190 && r.gradient >= 10 && r.gradient < 14) return `Kerb-style ramp (1:${r.gradient}, ${Math.round(run)} mm long) – usually only for short rises; check guidance.`;
  if (r.gradient < 14) return `Steeper than 1:14 – most guidance for wheelchair ramps asks for 1:14 or gentler.`;
  if (run > 9000 && r.gradient < 20) return 'Longer than about 9 m at 1:14 – guidance usually asks for an intermediate landing.';
  return `1:${r.gradient} over ${Math.round(run)} mm with a ${r.landing} mm landing.`;
};

