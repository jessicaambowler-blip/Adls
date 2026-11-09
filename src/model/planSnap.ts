// Snapping to the walls drawn on an uploaded floor plan while tracing it by hand.
//
// Near the pointer, look along the row and the column of pixels through it for the dark strokes a
// wall is drawn with: either one solid dark band (filled walls) or two thin parallel lines with
// light between (outline walls). The pointer snaps to the middle of the nearest such wall, and its
// width gives the wall thickness.

export interface PlanPixels { gray: Uint8Array; W: number; H: number; /** mm per pixel */ k: number; x0: number; y0: number }

interface Band { c: number; w: number } // centre and width, in pixels along the scan

const DARK = 120; // solidly dark (filled walls)
const DEPTH = 28; // or a thin line: this much darker than the paper on both sides of it

/** Is profile pixel i "ink": solidly dark, or a thin line darker than what is a few pixels either side. */
const inkAt = (v: number[], i: number) => {
  if (v[i] < DARK) return true;
  let l = 0, r = 0;
  for (let d = 1; d <= 4; d++) { if (i - d >= 0) l = Math.max(l, v[i - d]); if (i + d < v.length) r = Math.max(r, v[i + d]); }
  return v[i] < Math.min(l || 255, r || 255) - DEPTH;
};

/** Ink runs along a scan line of `len` pixels read by `at(i)`. */
const runs = (at: (i: number) => number, len: number): Band[] => {
  const v = Array.from({ length: len }, (_, i) => at(i));
  const out: Band[] = [];
  let s = -1;
  for (let i = 0; i <= len; i++) {
    const ink = i < len && inkAt(v, i);
    if (ink && s < 0) s = i;
    else if (!ink && s >= 0) { out.push({ c: (s + i - 1) / 2, w: i - s }); s = -1; }
  }
  return out;
};

/** Wall candidates on one scan line: solid bands, and pairs of thin lines a wall's width apart. */
const walls = (bands: Band[], k: number): Band[] => {
  const maxW = 450 / k, thin = 70 / k;
  const out: Band[] = [];
  for (const b of bands) if (b.w * k >= 60 && b.w <= maxW) out.push(b);
  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i], b = bands[i + 1];
    if (a.w > thin || b.w > thin) continue;
    const span = b.c + b.w / 2 - (a.c - a.w / 2);
    if (span * k >= 70 && span * k <= 420) out.push({ c: (a.c - a.w / 2 + b.c + b.w / 2) / 2, w: span });
  }
  return out;
};

export interface PlanSnap { x?: number; y?: number; thickness?: number }

/**
 * Where to snap a point (plan mm) to the walls drawn on the plan, within `tol` mm. Returns a snapped
 * x (centre of a vertical wall nearby) and/or y (centre of a horizontal wall nearby).
 */
export const snapToPlan = (px: PlanPixels, p: { x: number; y: number }, tol: number): PlanSnap => {
  const { gray, W, H, k, x0, y0 } = px;
  const cx = Math.round((p.x - x0) / k), cy = Math.round((p.y - y0) / k);
  const r = Math.max(3, Math.round(tol / k));
  if (cx < -r || cy < -r || cx > W + r || cy > H + r) return {};
  const out: PlanSnap = {};
  const thick: number[] = [];
  // along the row: vertical walls crossing it give x
  if (cy >= 0 && cy < H) {
    const a = Math.max(0, cx - r), b = Math.min(W, cx + r + 1);
    const cands = walls(runs((i) => gray[cy * W + a + i], b - a), k).map((w) => ({ c: w.c + a, w: w.w }));
    const best = cands.filter((w) => Math.abs(w.c - cx) <= r).sort((u, v) => Math.abs(u.c - cx) - Math.abs(v.c - cx))[0];
    if (best && verticalExtent(px, Math.round(best.c), cy, best.w) * k > 250) { out.x = x0 + best.c * k; thick.push(best.w * k); }
  }
  // along the column: horizontal walls crossing it give y
  if (cx >= 0 && cx < W) {
    const a = Math.max(0, cy - r), b = Math.min(H, cy + r + 1);
    const cands = walls(runs((i) => gray[(a + i) * W + cx], b - a), k).map((w) => ({ c: w.c + a, w: w.w }));
    const best = cands.filter((w) => Math.abs(w.c - cy) <= r).sort((u, v) => Math.abs(u.c - cy) - Math.abs(v.c - cy))[0];
    if (best && horizontalExtent(px, cx, Math.round(best.c), best.w) * k > 250) { out.y = y0 + best.c * k; thick.push(best.w * k); }
  }
  if (thick.length) out.thickness = Math.round(Math.max(...thick) / 10) * 10;
  return out;
};

/**
 * How far a wall line runs through (x, y) in the given direction (pixels): text and symbols are
 * short, walls are long. Looks for dark pixels within a couple of pixels of the line.
 */
const extent = (px: PlanPixels, x: number, y: number, dx: number, dy: number, w: number) => {
  const half = Math.ceil(w / 2) + 1;
  const { gray, W, H } = px;
  const darkNear = (X: number, Y: number) => {
    for (let o = -half; o <= half; o++) {
      const xx = X + dy * o, yy = Y + dx * o;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && gray[yy * W + xx] < 228) return true;
    }
    return false;
  };
  let n = 0;
  for (const s of [1, -1]) {
    let gap = 0;
    for (let i = 1; i < 2000; i++) {
      const X = x + dx * i * s, Y = y + dy * i * s;
      if (X < 0 || Y < 0 || X >= W || Y >= H) break;
      if (darkNear(X, Y)) { n++; gap = 0; } else if (++gap > 3) break;
    }
  }
  return n;
};
const verticalExtent = (px: PlanPixels, x: number, y: number, w: number) => extent(px, x, y, 0, 1, w);
const horizontalExtent = (px: PlanPixels, x: number, y: number, w: number) => extent(px, x, y, 1, 0, w);
