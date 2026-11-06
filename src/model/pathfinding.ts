import { itemBlocks, itemLabel } from './catalogue';
import { dirOfHeading, dist, headingOf, itemCorners, layoutBounds, polygonsOverlap, rotate, solidWallRects, sub } from './geometry';
import type { Layout, Vec2 } from './types';

export interface PoseSample { x: number; y: number; heading: number; t: number; dist: number }

export interface RouteResult {
  samples: PoseSample[];
  status: 'clear' | 'tight' | 'blocked';
  /** smallest gap (mm) between the chair's sides and an obstacle along the route (approximate) */
  minSideClearance: number;
  contacts: { at: Vec2; with: string }[];
  duration: number;
}

interface Obstacle { poly: Vec2[]; label: string; minX: number; maxX: number; minY: number; maxY: number }

const CELL = 50;

const pointInPoly = (p: Vec2, poly: Vec2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

export const obstaclesOf = (layout: Layout, ignoreIds: string[] = []): Obstacle[] => {
  const polys: { poly: Vec2[]; label: string }[] = solidWallRects(layout).map((poly) => ({ poly, label: 'wall' }));
  for (const it of layout.items) {
    if (!itemBlocks(it.kind) || ignoreIds.includes(it.id)) continue;
    if ((it.elevation ?? 0) > 700) continue; // wall-mounted above knee height
    polys.push({ poly: itemCorners(it), label: itemLabel(it.kind, it.label).toLowerCase() });
  }
  return polys.map(({ poly, label }) => ({
    poly, label,
    minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)),
    minY: Math.min(...poly.map((p) => p.y)), maxY: Math.max(...poly.map((p) => p.y)),
  }));
};

class Grid {
  w: number; h: number; ox: number; oy: number;
  blocked: Uint8Array; clearance: Float32Array;
  constructor(layout: Layout, obstacles: Obstacle[], extra: Vec2[]) {
    const b = layoutBounds(layout);
    const xs = [b.minX, b.maxX, ...extra.map((p) => p.x)];
    const ys = [b.minY, b.maxY, ...extra.map((p) => p.y)];
    this.ox = Math.min(...xs) - 1200;
    this.oy = Math.min(...ys) - 1200;
    this.w = Math.ceil((Math.max(...xs) + 1200 - this.ox) / CELL);
    this.h = Math.ceil((Math.max(...ys) + 1200 - this.oy) / CELL);
    this.blocked = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const p = this.centre(i, j);
      for (const o of obstacles) {
        if (p.x < o.minX || p.x > o.maxX || p.y < o.minY || p.y > o.maxY) continue;
        if (pointInPoly(p, o.poly)) { this.blocked[j * this.w + i] = 1; break; }
      }
    }
    // chamfer distance transform (mm to nearest blocked cell)
    const INF = 1e9;
    const d = new Float32Array(this.w * this.h);
    for (let k = 0; k < d.length; k++) d[k] = this.blocked[k] ? 0 : INF;
    const a = CELL, dg = CELL * Math.SQRT2;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - this.w] + a); if (i > 0) v = Math.min(v, d[k - this.w - 1] + dg); if (i < this.w - 1) v = Math.min(v, d[k - this.w + 1] + dg); }
      d[k] = v;
    }
    for (let j = this.h - 1; j >= 0; j--) for (let i = this.w - 1; i >= 0; i--) {
      const k = j * this.w + i; let v = d[k];
      if (i < this.w - 1) v = Math.min(v, d[k + 1] + a);
      if (j < this.h - 1) { v = Math.min(v, d[k + this.w] + a); if (i < this.w - 1) v = Math.min(v, d[k + this.w + 1] + dg); if (i > 0) v = Math.min(v, d[k + this.w - 1] + dg); }
      d[k] = v;
    }
    // distance from cell centre to the obstacle *edge* is about half a cell less
    for (let k = 0; k < d.length; k++) d[k] = Math.max(0, d[k] - CELL / 2);
    this.clearance = d;
  }
  centre(i: number, j: number): Vec2 { return { x: this.ox + (i + 0.5) * CELL, y: this.oy + (j + 0.5) * CELL }; }
  cellOf(p: Vec2) { return { i: Math.max(0, Math.min(this.w - 1, Math.floor((p.x - this.ox) / CELL))), j: Math.max(0, Math.min(this.h - 1, Math.floor((p.y - this.oy) / CELL))) }; }
  clearAt(p: Vec2) { const { i, j } = this.cellOf(p); return this.clearance[j * this.w + i]; }

  astar(from: Vec2, to: Vec2, radius: number): Vec2[] | null {
    const s = this.cellOf(from), g = this.cellOf(to);
    const W = this.w, N = W * this.h;
    const sk = s.j * W + s.i, gk = g.j * W + g.i;
    // near the start and goal the chair is allowed to be close to things (parking beside a bed, etc.)
    const relax = (k: number) => Math.min(Math.hypot((k % W) - g.i, Math.floor(k / W) - g.j), Math.hypot((k % W) - s.i, Math.floor(k / W) - s.j)) * CELL < 600;
    const ok = (k: number) => this.clearance[k] >= (relax(k) ? Math.min(radius, 150) : radius);
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    // binary heap
    const heap: number[] = []; const f = new Float32Array(N).fill(Infinity);
    const push = (k: number) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (f[heap[p]] <= f[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    const h = (k: number) => Math.hypot((k % W) - g.i, Math.floor(k / W) - g.j) * CELL;
    gScore[sk] = 0; f[sk] = h(sk); push(sk);
    const comfort = radius + 250;
    while (heap.length) {
      const k = pop();
      if (k === gk) break;
      if (closed[k]) continue; closed[k] = 1;
      const i = k % W, j = Math.floor(k / W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (closed[nk]) continue;
        if (!ok(nk) && nk !== gk) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * CELL;
        const penalty = Math.max(0, comfort - this.clearance[nk]) * 0.8; // prefer the middle of corridors
        const ng = gScore[k] + step + penalty * step / CELL;
        if (ng < gScore[nk]) { gScore[nk] = ng; came[nk] = k; f[nk] = ng + h(nk); push(nk); }
      }
    }
    if (came[gk] === -1 && gk !== sk) return null;
    const out: Vec2[] = [];
    for (let k = gk; k !== -1; k = came[k]) out.push(this.centre(k % W, Math.floor(k / W)));
    out.reverse();
    out[0] = from; out[out.length - 1] = to;
    return out;
  }

  lineClear(a: Vec2, b: Vec2, radius: number) {
    const n = Math.ceil(dist(a, b) / (CELL / 2));
    for (let s = 1; s < n; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n };
      if (this.clearAt(p) < radius) return false;
    }
    return true;
  }
}

const simplify = (grid: Grid, pts: Vec2[], radius: number) => {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !grid.lineClear(pts[i], pts[j], radius)) j--;
    out.push(pts[j]); i = j;
  }
  return out;
};

const chaikin = (pts: Vec2[], iterations = 3) => {
  let p = pts;
  for (let n = 0; n < iterations; n++) {
    if (p.length < 3) return p;
    const q: Vec2[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
};

const angleDiff = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** Turn a list of (x,y,heading) waypoints into timed samples. */
export const timeSamples = (pts: { x: number; y: number; heading: number }[], speed = 750, turnRate = 80, t0 = 0): PoseSample[] => {
  const out: PoseSample[] = [];
  let t = t0, d = 0;
  pts.forEach((p, i) => {
    if (i > 0) {
      const q = pts[i - 1];
      const ds = dist(p, q);
      const dh = Math.abs(angleDiff(q.heading, p.heading));
      t += Math.max(ds / speed, dh / turnRate);
      d += ds;
    }
    out.push({ ...p, t, dist: d });
  });
  return out;
};

export interface RouteRequest {
  start: Vec2 & { heading: number };
  goal: Vec2 & { heading?: number };
  chairWidth: number;
  chairLength: number;
  ignoreItemIds?: string[];
  /** straight final approach into the goal along the goal heading (mm). Negative = reverse in. */
  approach?: number;
  speed?: number;
}

export const planRoute = (layout: Layout, req: RouteRequest): RouteResult => {
  const obstacles = obstaclesOf(layout, req.ignoreItemIds);
  const grid = new Grid(layout, obstacles, [req.start, req.goal]);
  const half = req.chairWidth / 2;

  const approach = req.goal.heading !== undefined ? req.approach ?? 500 : 0;
  const preGoal = req.goal.heading !== undefined ? sub(req.goal, rotate({ x: 0, y: approach }, req.goal.heading)) : req.goal;

  let status: RouteResult['status'] = 'clear';
  let path: Vec2[] | null = null;
  for (const [r, st] of [[half + 60, 'clear'], [half + 10, 'tight'], [half - 60, 'tight']] as const) {
    path = grid.astar(req.start, preGoal, r);
    if (path) { status = st; path = simplify(grid, path, r); break; }
  }
  if (!path) { status = 'blocked'; path = [req.start, preGoal]; }
  if (approach !== 0) path.push({ x: req.goal.x, y: req.goal.y });

  const smooth = chaikin(path, 3);
  // resample every ~40 mm and attach headings
  const dense: Vec2[] = [];
  for (let i = 0; i < smooth.length - 1; i++) {
    const a = smooth[i], b = smooth[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / 40));
    for (let s = 0; s < n; s++) dense.push({ x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n });
  }
  dense.push(smooth[smooth.length - 1]);

  const withHeading: { x: number; y: number; heading: number }[] = [{ ...req.start }];
  let lastH = req.start.heading;
  for (let i = 1; i < dense.length; i++) {
    const look = dense[Math.min(dense.length - 1, i + 3)];
    const d = sub(look, dense[i - 1]);
    if (req.goal.heading !== undefined && dist(dense[i], req.goal) < Math.abs(approach) - 20) {
      // keep the final (forward or reversing) approach aligned with the goal heading
      lastH = lastH + angleDiff(lastH, req.goal.heading);
    } else if (Math.hypot(d.x, d.y) > 1) lastH = lastH + angleDiff(lastH, headingOf(d));
    withHeading.push({ ...dense[i], heading: lastH });
  }
  // insert a turn-on-the-spot at the start (from start heading to first travel heading)
  if (withHeading.length > 2) withHeading.splice(1, 0, { ...withHeading[0], heading: withHeading[2].heading });
  if (req.goal.heading !== undefined) {
    const last = withHeading[withHeading.length - 1];
    withHeading.push({ x: last.x, y: last.y, heading: last.heading + angleDiff(last.heading, req.goal.heading) });
  }

  const samples = timeSamples(withHeading, req.speed ?? 750);

  // Check the chair footprint along the route against walls and furniture.
  const contacts: RouteResult['contacts'] = [];
  let minSide = Infinity;
  const lastBy = new Map<string, number>();
  for (const s of samples) {
    if (dist(s, req.goal) > Math.abs(approach) + 400 && dist(s, req.start) > 600) minSide = Math.min(minSide, grid.clearAt(s) - half);
    const fp = chairFootprint(s, req.chairWidth, req.chairLength);
    const hit = obstacles.find((o) => polygonsOverlap(fp, o.poly));
    if (hit && s.dist - (lastBy.get(hit.label) ?? -1e9) > 900) {
      contacts.push({ at: { x: s.x, y: s.y }, with: hit.label });
    }
    if (hit) lastBy.set(hit.label, s.dist);
  }
  if (contacts.length && status === 'clear') status = 'tight';

  return { samples, status, minSideClearance: Number.isFinite(minSide) ? Math.round(Math.max(-999, minSide)) : 999, contacts, duration: samples[samples.length - 1]?.t ?? 0 };
};

/** Chair footprint rectangle; origin is the chair's centre, front = heading direction. */
export const chairFootprint = (p: { x: number; y: number; heading: number }, width: number, length: number): Vec2[] => {
  const hw = width / 2, hl = length / 2;
  return [
    { x: -hw, y: -hl }, { x: hw, y: -hl }, { x: hw, y: hl }, { x: -hw, y: hl },
  ].map((c) => { const r = rotate(c, p.heading); return { x: p.x + r.x, y: p.y + r.y }; });
};

export const sampleAt = (samples: PoseSample[], t: number): { x: number; y: number; heading: number; dist: number } => {
  if (!samples.length) return { x: 0, y: 0, heading: 0, dist: 0 };
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi];
  const u = (t - a.t) / (b.t - a.t || 1);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, heading: a.heading + (b.heading - a.heading) * u, dist: a.dist + (b.dist - a.dist) * u };
};

export { dirOfHeading };

/**
 * For each candidate start, flood-fill the floor a wheelchair can reach. Returns the start that
 * reaches the most floor inside the house, and the most open reachable spot as a goal.
 */
export const exploreFrom = (layout: Layout, starts: (Vec2 & { heading: number })[], chairWidth: number) => {
  if (!starts.length) return null;
  const grid = new Grid(layout, obstaclesOf(layout), starts);
  const b = layoutBounds({ ...layout, items: [] });
  const need = chairWidth / 2 + 20;
  let best: { start: Vec2 & { heading: number }; goal: Vec2; reached: number } | null = null;
  for (const st of starts) {
    const s = grid.cellOf(st);
    const W = grid.w, N = W * grid.h;
    const seen = new Uint8Array(N);
    const q = [s.j * W + s.i];
    seen[q[0]] = 1;
    let reached = 0, goalK = -1, goalScore = -1;
    while (q.length) {
      const k = q.pop()!;
      const i = k % W, j = Math.floor(k / W);
      const p = grid.centre(i, j);
      const inside = p.x > b.minX + 200 && p.x < b.maxX - 200 && p.y > b.minY + 200 && p.y < b.maxY - 200;
      if (inside) {
        reached++;
        const score = Math.min(grid.clearance[k], 1500) + Math.min(800, dist(p, st) / 4);
        if (score > goalScore) { goalScore = score; goalK = k; }
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= grid.h) continue;
        const nk = nj * W + ni;
        if (seen[nk]) continue;
        // let the flood start right next to a wall (the start point sits outside a doorway)
        if (grid.clearance[nk] < need && dist(grid.centre(ni, nj), st) > 500) continue;
        seen[nk] = 1;
        q.push(nk);
      }
    }
    if (goalK >= 0 && (!best || reached > best.reached)) best = { start: st, goal: grid.centre(goalK % W, Math.floor(goalK / W)), reached };
  }
  return best;
};
