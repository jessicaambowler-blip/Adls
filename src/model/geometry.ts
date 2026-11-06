import type { Item, Layout, Opening, Vec2, Wall } from './types';

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

export const wallLength = (w: Wall) => dist(w.a, w.b);
export const wallDir = (w: Wall) => norm(sub(w.b, w.a));
/** left-hand normal of the wall (on a y-down plan) */
export const wallNormal = (w: Wall): Vec2 => {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
};

/** Point on the wall centreline at distance `t` mm from a. */
export const wallPoint = (w: Wall, t: number): Vec2 => add(w.a, mul(wallDir(w), t));

/** Rotate a plan vector by `degrees` clockwise (y-down plan). */
export const rotate = (v: Vec2, degrees: number): Vec2 => {
  const r = rad(degrees);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** Item local -> plan. Local x = width, local y = depth, +y = the item's front. */
export const itemToPlan = (it: Pick<Item, 'x' | 'y' | 'rotation'>, local: Vec2): Vec2 =>
  add({ x: it.x, y: it.y }, rotate(local, it.rotation));

export const planToItem = (it: Pick<Item, 'x' | 'y' | 'rotation'>, p: Vec2): Vec2 =>
  rotate(sub(p, { x: it.x, y: it.y }), -it.rotation);

export const itemCorners = (it: Item): Vec2[] => {
  const hw = it.w / 2;
  const hd = it.d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => itemToPlan(it, p));
};

/** heading in plan degrees for a direction vector (0 = facing +y / down the page) */
export const headingOf = (d: Vec2) => deg(Math.atan2(-d.x, d.y));
export const dirOfHeading = (h: number): Vec2 => rotate({ x: 0, y: 1 }, h);

export const projectOnSegment = (p: Vec2, a: Vec2, b: Vec2) => {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  const q = add(a, mul(ab, t));
  return { t, point: q, distance: dist(p, q) };
};

export const nearestWall = (layout: Layout, p: Vec2) => {
  let best: { wall: Wall; t: number; distance: number; point: Vec2 } | null = null;
  for (const w of layout.walls) {
    const r = projectOnSegment(p, w.a, w.b);
    if (!best || r.distance < best.distance) best = { wall: w, t: r.t * wallLength(w), distance: r.distance, point: r.point };
  }
  return best;
};

export const layoutBounds = (layout: Layout) => {
  const pts: Vec2[] = [];
  layout.walls.forEach((w) => pts.push(w.a, w.b));
  layout.items.forEach((it) => pts.push(...itemCorners(it)));
  if (!pts.length) pts.push({ x: 0, y: 0 }, { x: 4000, y: 4000 });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

/** Centre of the enclosed area (average of wall endpoints). */
export const layoutCentre = (layout: Layout): Vec2 => {
  const b = layoutBounds(layout);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

/** Clear opening estimate for a hinged door leaf (leaf width less stops & door thickness). */
export const clearOpening = (o: Opening) => {
  if (o.kind === 'door') return o.width - 70;
  if (o.kind === 'sliding-door') return o.width - 40;
  return o.width;
};

export const openingCentre = (layout: Layout, o: Opening): Vec2 | null => {
  const w = layout.walls.find((x) => x.id === o.wallId);
  return w ? wallPoint(w, o.offset) : null;
};

/** Is the point inside the polygon formed by chaining the walls? (ray casting over all wall segments) */
export const insideWalls = (layout: Layout, p: Vec2) => {
  let inside = false;
  for (const w of layout.walls) {
    const { a, b } = w;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** Convex polygon overlap (separating axis theorem). */
export const polygonsOverlap = (A: Vec2[], B: Vec2[]) => {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      const axis = { x: p2.y - p1.y, y: p1.x - p2.x };
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of A) { const v = p.x * axis.x + p.y * axis.y; minA = Math.min(minA, v); maxA = Math.max(maxA, v); }
      for (const p of B) { const v = p.x * axis.x + p.y * axis.y; minB = Math.min(minB, v); maxB = Math.max(maxB, v); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
};

export const segmentRect = (a: Vec2, b: Vec2, thickness: number): Vec2[] => {
  const d = norm(sub(b, a));
  const n = { x: -d.y * thickness / 2, y: d.x * thickness / 2 };
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
};

/** Wall pieces (as rectangles) with the door/opening gaps removed – used for collision. */
export const solidWallRects = (layout: Layout): Vec2[][] => {
  const rects: Vec2[][] = [];
  for (const w of layout.walls) {
    const L = wallLength(w);
    const gaps = layout.openings
      .filter((o) => o.wallId === w.id && o.kind !== 'window')
      .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [g0, g1] of gaps) {
      if (g0 > t) rects.push(segmentRect(wallPoint(w, t), wallPoint(w, g0), w.thickness));
      t = Math.max(t, g1);
    }
    if (t < L) rects.push(segmentRect(wallPoint(w, t), wallPoint(w, L), w.thickness));
  }
  return rects;
};
