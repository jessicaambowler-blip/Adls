import { add, dist, projectOnSegment, sub, uid, wallDir, wallLength, wallNormal, wallPoint } from './geometry';
import type { Layout, Opening, Vec2, Wall } from './types';

// Editing walls as connected pieces. A wall is a straight segment between two points; walls meet
// where an end of one touches an end of another (a corner) or touches the middle of another (a T).
// These functions keep those joints together while walls are split, moved, stretched and drawn,
// and keep doors and windows where they were.

const EPS = 2; // mm

const same = (p: Vec2, q: Vec2) => dist(p, q) < EPS;
const parallel = (a: Wall, b: Wall) => Math.abs(wallDir(a).x * wallDir(b).y - wallDir(a).y * wallDir(b).x) < 0.02;
const cloneWalls = (ws: Wall[]) => ws.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } }));

/** Where p lies on wall w: distance along it and distance from its centre line. */
const onWall = (w: Wall, p: Vec2) => {
  const L = wallLength(w);
  const pr = projectOnSegment(p, w.a, w.b);
  return { t: pr.t * L, off: dist(pr.point, p), L };
};

/** Is p on the middle part of w (not at either end)? */
const onInterior = (w: Wall, p: Vec2) => {
  const { t, off, L } = onWall(w, p);
  return off < EPS && t > EPS && t < L - EPS;
};

/** Centre point of every door/window, so they can be put back after walls change. */
const openingCentres = (l: Layout) => new Map(l.openings.map((o) => {
  const w = l.walls.find((x) => x.id === o.wallId);
  return [o.id, w ? wallPoint(w, o.offset) : null] as const;
}));

/** Put each opening back at its old position on whichever of `wallIds` it now lies on. */
const reattach = (l: Layout, centres: Map<string, Vec2 | null>, wallIds?: string[]) => {
  for (const o of l.openings) {
    const c = centres.get(o.id);
    if (!c) continue;
    // the wall it now lies on (only walls passing through its old centre), else its own wall
    const candidates = l.walls.filter((w) => w.id === o.wallId || (wallIds?.includes(w.id) ?? false));
    let best: { w: Wall; t: number } | null = null;
    let bestOff = Infinity;
    for (const w of candidates) {
      const r = onWall(w, c);
      if (r.off > EPS && w.id !== o.wallId) continue;
      if (r.t < o.width / 2 - EPS || r.t > r.L - o.width / 2 + EPS) continue;
      if (r.off < bestOff) { bestOff = r.off; best = { w, t: r.t }; }
    }
    if (best) { o.wallId = best.w.id; o.offset = Math.round(best.t); continue; }
    const w = l.walls.find((x) => x.id === o.wallId);
    if (w) { const L = wallLength(w); o.offset = Math.round(Math.max(Math.min(o.width / 2, L / 2), Math.min(L - o.width / 2, onWall(w, c).t))); }
  }
};

/** Split a wall at the point nearest p. Returns the ids of the two pieces (or null if p is at an end). */
export const splitWall = (l: Layout, wallId: string, p: Vec2): [string, string] | null => {
  const w = l.walls.find((x) => x.id === wallId);
  if (!w) return null;
  let { t } = onWall(w, p);
  const { L } = onWall(w, p);
  // never cut through a door or window: move the cut to its nearer edge
  for (const o of l.openings.filter((x) => x.wallId === w.id)) {
    const s0 = o.offset - o.width / 2, s1 = o.offset + o.width / 2;
    if (t > s0 - 10 && t < s1 + 10) t = t - s0 < s1 - t ? s0 - 10 : s1 + 10;
  }
  if (t < 50 || t > L - 50) return null;
  const centres = openingCentres(l);
  const m = wallPoint(w, Math.round(t));
  const second: Wall = { ...w, id: uid('wall'), a: { ...m }, b: { ...w.b } };
  w.b = { ...m };
  l.walls.splice(l.walls.indexOf(w) + 1, 0, second);
  reattach(l, centres, [w.id, second.id]);
  return [w.id, second.id];
};

/** Make every T-junction an explicit joint: split walls whose middle another wall's end touches. */
export const splitAtJunctions = (l: Layout) => {
  const tried = new Set<string>();
  let changed = true;
  for (let guard = 0; changed && guard < 200; guard++) {
    changed = false;
    outer: for (const w of [...l.walls]) {
      for (const x of l.walls) {
        if (x === w) continue;
        for (const e of [x.a, x.b]) {
          const key = `${w.id}|${Math.round(e.x)},${Math.round(e.y)}`;
          if (tried.has(key) || !onInterior(w, e)) continue;
          tried.add(key);
          // (a junction in the middle of a door or window is left as it is)
          const r = splitWall(l, w.id, e);
          if (r && l.walls.some((q) => q.id === r[0] && same(q.b, e))) { changed = true; break outer; }
        }
      }
    }
  }
};

/** Remove zero-length walls left behind by edits. */
export const tidyWalls = (l: Layout) => {
  const gone = new Set(l.walls.filter((w) => wallLength(w) < 5).map((w) => w.id));
  if (!gone.size) return;
  l.walls = l.walls.filter((w) => !gone.has(w.id));
  l.openings = l.openings.filter((o) => !gone.has(o.wallId));
};

/**
 * How dragging wall `wallId` sideways will affect the others, worked out once when the drag starts:
 * walls joined at its ends at an angle (and walls T-ing into its middle) stretch to follow; a wall
 * continuing in a straight line stays put and a short connecting wall is added, giving a step.
 */
export interface WallDrag { wallId: string; orig: Wall[]; origOpenings: Opening[]; jogs: { id: string; from: Vec2 }[] }

export const beginWallDrag = (l: Layout, wallId: string): WallDrag => {
  const w = l.walls.find((x) => x.id === wallId)!;
  const jogs: WallDrag['jogs'] = [];
  for (const e of [w.a, w.b]) {
    if (l.walls.some((x) => x.id !== w.id && (same(x.a, e) || same(x.b, e)) && parallel(x, w))) jogs.push({ id: uid('wall'), from: { ...e } });
  }
  return { wallId, orig: cloneWalls(l.walls), origOpenings: l.openings.map((o) => ({ ...o })), jogs };
};

/** Apply a sideways move of `amount` mm (along the wall's normal) to a fresh copy of the walls. */
export const applyWallDrag = (l: Layout, d: WallDrag, amount: number) => {
  const walls = cloneWalls(d.orig);
  const w = walls.find((x) => x.id === d.wallId)!;
  const v = { x: wallNormal(w).x * amount, y: wallNormal(w).y * amount };
  const a0 = { ...w.a }, b0 = { ...w.b };
  const fixedEnds = d.jogs.map((j) => j.from);
  for (const x of walls) {
    if (x === w) continue;
    for (const end of ['a', 'b'] as const) {
      const p = x[end];
      const atEnd = same(p, a0) || same(p, b0);
      // a wall carrying on in a straight line keeps its end; a step joins them instead
      if (atEnd && parallel(x, w) && fixedEnds.some((f) => same(f, p))) continue;
      if (atEnd || onInterior(w, p)) x[end] = add(p, v);
    }
  }
  w.a = add(a0, v);
  w.b = add(b0, v);
  if (Math.abs(amount) >= 5) {
    for (const j of d.jogs) walls.push({ id: j.id, a: { ...j.from }, b: add(j.from, v), thickness: w.thickness });
  }
  l.walls = walls;
  // openings keep their position along walls that only moved sideways; re-anchor the rest
  l.openings = d.origOpenings.map((o) => ({ ...o }));
  const centres = new Map(l.openings.map((o) => {
    const ow = d.orig.find((x) => x.id === o.wallId);
    if (!ow) return [o.id, null] as const;
    const c = wallPoint(ow, o.offset);
    return [o.id, o.wallId === d.wallId ? add(c, v) : c] as const;
  }));
  reattach(l, centres);
};

/** All wall ends at (or within `tol` of) a point. */
export const endsAt = (l: Layout, p: Vec2, tol = EPS) =>
  l.walls.flatMap((w) => (['a', 'b'] as const).filter((e) => dist(w[e], p) < tol).map((e) => ({ wall: w, end: e })));

/** Move a corner (every wall end at `from`) to `to`, keeping doors and windows in place. */
export const moveCorner = (l: Layout, from: Vec2, to: Vec2) => {
  const centres = openingCentres(l);
  for (const { wall, end } of endsAt(l, from)) wall[end] = { ...to };
  reattach(l, centres);
};

/** Set a wall's inside length by moving its far end (and whatever is joined there). */
export const setWallLength = (l: Layout, wallId: string, insideLength: number) => {
  const w = l.walls.find((x) => x.id === wallId);
  if (!w) return;
  const L = insideLength + w.thickness;
  const to = add(w.a, { x: wallDir(w).x * L, y: wallDir(w).y * L });
  moveCorner(l, { ...w.b }, to);
};

/** Remove a wall; if the two walls left at either end now carry on in a straight line, join them. */
export const removeWall = (l: Layout, wallId: string) => {
  const w = l.walls.find((x) => x.id === wallId);
  if (!w) return;
  l.walls = l.walls.filter((x) => x.id !== wallId);
  l.openings = l.openings.filter((o) => o.wallId !== wallId);
};

// ------------------------------------------------------------------ drawing

export interface Snap { p: Vec2; kind: 'corner' | 'wall' | 'grid'; wallId?: string }

/**
 * Snap a point for drawing: to an existing corner, else onto an existing wall, else to a 50 mm grid
 * (square to the previous point when nearly horizontal or vertical).
 */
export const snapPoint = (l: Layout, p: Vec2, tol: number, prev?: Vec2): Snap => {
  let best: Snap | null = null;
  let bd = tol;
  for (const w of l.walls) for (const e of [w.a, w.b]) {
    const d = dist(e, p);
    if (d < bd) { bd = d; best = { p: { ...e }, kind: 'corner' }; }
  }
  if (best) return best;
  // keep square to the previous point when close to horizontal/vertical
  let q = { x: Math.round(p.x / 50) * 50, y: Math.round(p.y / 50) * 50 };
  if (prev) {
    const d = sub(q, prev);
    if (Math.abs(d.x) < Math.abs(d.y) * 0.18) q = { x: prev.x, y: q.y };
    else if (Math.abs(d.y) < Math.abs(d.x) * 0.18) q = { x: q.x, y: prev.y };
  }
  bd = tol;
  for (const w of l.walls) {
    const pr = projectOnSegment(q, w.a, w.b);
    const d = dist(pr.point, q);
    if (d < bd && pr.t > 0 && pr.t < 1) {
      bd = d;
      // slide along the wall but stay square to the previous point if that still lands on it
      let at = pr.point;
      if (prev) {
        const ax = Math.abs(wallDir(w).x) > 0.99, ay = Math.abs(wallDir(w).y) > 0.99;
        if (ay && Math.abs(q.y - prev.y) < 1) at = { x: w.a.x, y: prev.y };
        else if (ax && Math.abs(q.x - prev.x) < 1) at = { x: prev.x, y: w.a.y };
      }
      best = { p: { x: Math.round(at.x), y: Math.round(at.y) }, kind: 'wall', wallId: w.id };
    }
  }
  return best ?? { p: q, kind: 'grid' };
};

/** Add walls along a drawn line (open polyline, or closed when the last point equals the first). */
export const addWalls = (l: Layout, points: Vec2[], thickness = 110) => {
  const added: Wall[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const L = dist(a, b);
    if (L < 20) continue;
    const seg: Wall = { id: '', a, b, thickness };
    // parts of this line already covered by an existing wall in line with it are not added again
    const covered: [number, number][] = [];
    for (const w of l.walls) {
      if (!parallel(w, seg)) continue;
      const offA = distToLine(w.a, a, b), offB = distToLine(w.b, a, b);
      if (offA > EPS || offB > EPS) continue;
      const tA = along(w.a, a, b), tB = along(w.b, a, b);
      covered.push([Math.max(0, Math.min(tA, tB)), Math.min(L, Math.max(tA, tB))]);
    }
    covered.sort((p1, p2) => p1[0] - p2[0]);
    let t = 0;
    const pieces: [number, number][] = [];
    for (const [c0, c1] of covered) {
      if (c1 <= c0) continue;
      if (c0 > t + 20) pieces.push([t, c0]);
      t = Math.max(t, c1);
    }
    if (L > t + 20) pieces.push([t, L]);
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    for (const [t0, t1] of pieces) {
      const w: Wall = { id: uid('wall'), a: { x: Math.round(a.x + dir.x * t0), y: Math.round(a.y + dir.y * t0) }, b: { x: Math.round(a.x + dir.x * t1), y: Math.round(a.y + dir.y * t1) }, thickness };
      l.walls.push(w);
      added.push(w);
    }
  }
  splitAtJunctions(l);
  return added;
};

const along = (p: Vec2, a: Vec2, b: Vec2) => {
  const L = dist(a, b);
  return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L;
};
const distToLine = (p: Vec2, a: Vec2, b: Vec2) => {
  const L = dist(a, b);
  return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / L;
};

/** Add a rectangular room (inside corners p and q, plan mm), joining onto walls it touches. */
export const addRoom = (l: Layout, p: Vec2, q: Vec2, thickness = 110) => {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  if (x1 - x0 < 500 || y1 - y0 < 500) return [];
  return addWalls(l, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }], thickness);
};
