// Floor-plan wall detection benchmark.
//
//   npm run bench            (all plans)
//   npm run bench -- 302     (one floor id)
//
// Scores src/model/detect.ts against plans with ground-truth wall positions:
//   precision = share of detected wall length that lies on a real wall
//   recall    = share of real wall length that was detected
// Data: sample floors from MLSTRUCT-FP (MIT licence, see bench/data/mlstruct-fp/LICENSE).
// Note: MLSTRUCT-FP labels structural walls only, so detected partition walls lower "precision"
// on the detailed apartment plan (floor 302) even when they are real walls.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { detectPlan } from '../src/model/detect';

type P = { x: number; y: number };
const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, 'data', 'mlstruct-fp');
const MAX_SIDE = 3400; // same limit the app uses
const only = process.argv[2];

interface Rect { floorID: number; x: number[]; y: number[] }
const fp = JSON.parse(readFileSync(join(DATA, 'fp.json'), 'utf8')) as {
  rect: Record<string, Rect>;
  floor: Record<string, { image: string; scale: number }>;
};

/** greyscale over white, shrunk by a whole factor keeping thin lines (same as the app) */
const loadGray = (file: string) => {
  const png = PNG.sync.read(readFileSync(join(DATA, file)));
  const { width: w, height: h, data } = png;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / MAX_SIDE));
  const W = Math.floor(w / f), H = Math.floor(h / f);
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sum = 0, mn = 255;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const i = ((y * f + dy) * w + x * f + dx) * 4;
      const a = data[i + 3] / 255;
      const v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
      sum += v; if (v < mn) mn = v;
    }
    g[y * W + x] = f === 1 ? mn : (sum / (f * f) + mn) / 2;
  }
  return { g, W, H, f };
};

const distSeg = (p: P, a: P, b: P) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const inPoly = (p: P, poly: P[]) => {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
};
const grow = (poly: P[], d: number) => {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length, cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => { const vx = p.x - cx, vy = p.y - cy, l = Math.hypot(vx, vy) || 1; return { x: p.x + (vx / l) * d * 1.42, y: p.y + (vy / l) * d * 1.42 }; });
};
const sample = (a: P, b: P, step: number) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(L / step));
  return Array.from({ length: k + 1 }, (_, s) => ({ x: a.x + ((b.x - a.x) * s) / k, y: a.y + ((b.y - a.y) * s) / k }));
};

let cache: { file: string; img: ReturnType<typeof loadGray> } | null = null;
let sumP = 0, sumR = 0, n = 0;
console.log('floor  image     size        mm/px  style    walls  doors  windows  precision  recall   time');
for (const [fid, floor] of Object.entries(fp.floor)) {
  if (only && fid !== only) continue;
  const rects = Object.values(fp.rect).filter((r) => String(r.floorID) === fid);
  if (!rects.length) continue;
  if (cache?.file !== floor.image) cache = { file: floor.image, img: loadGray(floor.image) };
  const { g, W, H, f } = cache.img;
  const sc = floor.scale / f; // detection pixels per metre
  const mm = 1000 / sc;
  const gt = rects.map((r) => r.x.map((x, i) => ({ x: x * sc, y: -r.y[i] * sc })));
  const xs = gt.flat().map((p) => p.x), ys = gt.flat().map((p) => p.y);
  // the user's "box around the floor": the walls' extent plus a metre
  const rect = { x0: Math.min(...xs) - sc, y0: Math.min(...ys) - sc, x1: Math.max(...xs) + sc, y1: Math.max(...ys) + sc };

  const t0 = Date.now();
  const r = detectPlan(g, W, H, { mmPerPx: mm, rect });
  const ms = Date.now() - t0;

  const tol = 150 / mm; // within 150 mm of a real wall counts
  const solid: [P, P][] = [];
  r.walls.forEach((w, i) => {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1, ux = (w.b.x - w.a.x) / L, uy = (w.b.y - w.a.y) / L;
    const gaps = r.openings.filter((o) => o.wall === i).map((o) => [o.offsetPx - o.widthPx / 2, o.offsetPx + o.widthPx / 2]).sort((a, b) => a[0] - b[0]);
    let s = 0;
    for (const [g0, g1] of [...gaps, [L, L]]) {
      if (g0 > s) solid.push([{ x: w.a.x + ux * s, y: w.a.y + uy * s }, { x: w.a.x + ux * g0, y: w.a.y + uy * g0 }]);
      s = Math.max(s, g1);
    }
  });
  const grown = gt.map((p) => grow(p, tol));
  let dOk = 0, dN = 0;
  for (const [a, b] of solid) for (const p of sample(a, b, 4)) { dN++; if (grown.some((q) => inPoly(p, q))) dOk++; }
  let gOk = 0, gN = 0;
  for (const poly of gt) {
    const e = [0, 1, 2, 3].map((i) => Math.hypot(poly[(i + 1) % 4].x - poly[i].x, poly[(i + 1) % 4].y - poly[i].y));
    const mid = (i: number) => ({ x: (poly[i].x + poly[(i + 1) % 4].x) / 2, y: (poly[i].y + poly[(i + 1) % 4].y) / 2 });
    const [a, b] = e[0] >= e[1] ? [mid(1), mid(3)] : [mid(0), mid(2)];
    for (const p of sample(a, b, 4)) { gN++; if (solid.some(([q0, q1]) => distSeg(p, q0, q1) <= tol + 2)) gOk++; }
  }
  const prec = dN ? dOk / dN : 0, rec = gN ? gOk / gN : 0;
  sumP += prec; sumR += rec; n++;
  const doors = r.openings.filter((o) => o.kind === 'door').length, windows = r.openings.filter((o) => o.kind === 'window').length;
  console.log(
    `${fid.padEnd(6)} ${floor.image.slice(0, 8)}  ${`${W}x${H}`.padEnd(10)} ${mm.toFixed(1).padStart(6)}  ${r.style.padEnd(8)} ${String(r.walls.length).padStart(5)}  ${String(doors).padStart(5)}  ${String(windows).padStart(7)}  ${`${(prec * 100).toFixed(0)}%`.padStart(9)}  ${`${(rec * 100).toFixed(0)}%`.padStart(6)}  ${ms} ms`,
  );
}
if (n) console.log(`\nMEAN over ${n} floors: precision ${((sumP / n) * 100).toFixed(0)}%, recall ${((sumR / n) * 100).toFixed(0)}%`);
