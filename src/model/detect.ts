// Automatic wall / door / window detection from a raster floor plan.
//
// Works on orthogonal plans (the vast majority of houses). Approach:
//  1. Walls are drawn with the heaviest line weight on a plan. Keep only pixels that are both dark
//     and at least as thick as the plan's wall strokes; this drops furniture, hatching, dimension
//     lines and verandah balustrades, which are drawn thinner or lighter.
//  2. Collect long horizontal and vertical runs of those pixels and group them into segments.
//  3. Join collinear segments across short gaps; a gap the size of a doorway becomes an opening.
//  4. Snap segment ends onto the walls they meet so corners and T-junctions close.
//  5. Classify each opening: a quarter-circle swing next to it = door; thin lines across = window.
// Everything returned is a PROPOSAL in image pixels; the user reviews it before it is used.

export interface PxPoint { x: number; y: number }
export interface DetectedWall { a: PxPoint; b: PxPoint; thicknessPx: number }
export interface DetectedOpening {
  wall: number; // index into walls
  offsetPx: number; // from wall.a to the opening centre
  widthPx: number;
  kind: 'door' | 'window' | 'opening';
  hinge: 'start' | 'end';
  /** +1 / -1 relative to the wall's left-hand normal (same convention as Opening.swingSide) */
  swingSide: 1 | -1;
  confidence: number; // 0..1
}
export interface DetectResult {
  walls: DetectedWall[];
  openings: DetectedOpening[];
  strokePx: number;
  /** mm per pixel suggested by the typical doorway size (only an estimate) */
  scaleFromDoors?: number;
}

export interface DetectOptions {
  /** current mm-per-pixel of the image (from calibration, or a rough guess) */
  mmPerPx: number;
  /** region to search, in image pixels */
  rect?: { x0: number; y0: number; x1: number; y1: number };
  darkThreshold?: number;
}

interface Seg { horiz: boolean; c: number; s0: number; s1: number; t: number }

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export const toGray = (img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }) => {
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0; i < g.length; i++) {
    const r = img.data[i * 4], gg = img.data[i * 4 + 1], b = img.data[i * 4 + 2], a = img.data[i * 4 + 3];
    const v = 0.299 * r + 0.587 * gg + 0.114 * b;
    g[i] = a < 128 ? 255 : v; // transparent = paper
  }
  return g;
};

export const detectPlan = (gray: Uint8Array, W: number, H: number, opt: DetectOptions): DetectResult => {
  const R = opt.rect ?? { x0: 0, y0: 0, x1: W, y1: H };
  const x0 = Math.max(0, Math.floor(R.x0)), y0 = Math.max(0, Math.floor(R.y0));
  const x1 = Math.min(W, Math.ceil(R.x1)), y1 = Math.min(H, Math.ceil(R.y1));
  const mm = opt.mmPerPx;
  const px = (mmv: number) => mmv / mm;

  // --- 1. dark mask and stroke thickness
  const thr = opt.darkThreshold ?? 105;
  const dark = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (gray[y * W + x] < thr) dark[y * W + x] = 1;

  // local stroke thickness = min(horizontal run, vertical run) through each dark pixel
  const hRun = new Uint16Array(W * H), vRun = new Uint16Array(W * H);
  for (let y = y0; y < y1; y++) {
    let x = x0;
    while (x < x1) {
      if (!dark[y * W + x]) { x++; continue; }
      let e = x; while (e < x1 && dark[y * W + e]) e++;
      for (let k = x; k < e; k++) hRun[y * W + k] = e - x;
      x = e;
    }
  }
  for (let x = x0; x < x1; x++) {
    let y = y0;
    while (y < y1) {
      if (!dark[y * W + x]) { y++; continue; }
      let e = y; while (e < y1 && dark[e * W + x]) e++;
      for (let k = y; k < e; k++) vRun[k * W + x] = e - y;
      y = e;
    }
  }
  const thick: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = y * W + x;
    if (dark[k] && Math.max(hRun[k], vRun[k]) >= px(500)) thick.push(Math.min(hRun[k], vRun[k]));
  }
  const p90 = thick.length ? [...thick].sort((a, b) => a - b)[Math.floor(thick.length * 0.9)] : 1;
  const strokePx = Math.max(1, Math.round(p90 * 0.55));
  const wall = new Uint8Array(W * H);
  for (let k = 0; k < wall.length; k++) if (dark[k] && Math.min(hRun[k], vRun[k]) >= strokePx) wall[k] = 1;
  // pixels that are part of a long thin line but belong to a thick stroke along the other axis are kept above

  // --- 2. runs -> segments
  const minRun = Math.max(4, px(420));
  const maxThick = Math.max(strokePx * 4 + 2, px(450));
  const collect = (horiz: boolean): Seg[] => {
    const segs: Seg[] = [];
    let active: (Seg & { last: number; cs: number[] })[] = [];
    const outer0 = horiz ? y0 : x0, outer1 = horiz ? y1 : x1;
    const inner0 = horiz ? x0 : y0, inner1 = horiz ? x1 : y1;
    const at = (o: number, i: number) => (horiz ? wall[o * W + i] : wall[i * W + o]);
    for (let o = outer0; o < outer1; o++) {
      const runs: [number, number][] = [];
      let i = inner0;
      while (i < inner1) {
        if (!at(o, i)) { i++; continue; }
        let e = i;
        // allow single-pixel breaks (anti-aliasing)
        while (e < inner1 && (at(o, e) || (e + 1 < inner1 && at(o, e + 1)))) e++;
        if (e - i >= minRun) runs.push([i, e]);
        i = e + 1;
      }
      const next: typeof active = [];
      for (const [r0, r1] of runs) {
        const m = active.find((s) => s.last === o - 1 && Math.min(s.s1, r1) - Math.max(s.s0, r0) > 0.5 * Math.min(s.s1 - s.s0, r1 - r0));
        if (m) { m.s0 = Math.min(m.s0, r0); m.s1 = Math.max(m.s1, r1); m.last = o; m.cs.push(o); m.t++; next.push(m); active = active.filter((s) => s !== m); }
        else next.push({ horiz, c: o, s0: r0, s1: r1, t: 1, last: o, cs: [o] });
      }
      for (const s of active) segs.push({ horiz, c: s.cs.reduce((a, b) => a + b, 0) / s.cs.length + 0.5, s0: s.s0, s1: s.s1, t: s.t });
      active = next;
    }
    for (const s of active) segs.push({ horiz, c: s.cs.reduce((a, b) => a + b, 0) / s.cs.length + 0.5, s0: s.s0, s1: s.s1, t: s.t });
    return segs.filter((s) => s.t <= maxThick);
  };
  let segs = [...collect(true), ...collect(false)];

  // --- helpers for reading what is drawn in a gap
  const ink = (x: number, y: number, lim = 215) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && gray[yy * W + xx] < lim) return true;
    }
    return false;
  };
  const toImg = (l: { horiz: boolean; c: number }, along: number, across: number) => (l.horiz ? { x: along, y: l.c + across } : { x: l.c + across, y: along });

  /** What is in the gap [g0,g1] of a wall line? */
  const classify = (l: { horiz: boolean; c: number }, g0: number, g1: number) => {
    const w = g1 - g0;
    // door swing: look for a quarter arc of radius w (single leaf) from either jamb, either side
    let best = { score: 0, hinge: 'start' as 'start' | 'end', side: 1 as 1 | -1, double: false };
    for (const hinge of ['start', 'end'] as const) for (const side of [1, -1] as const) {
      const h = hinge === 'start' ? g0 : g1;
      const dir = hinge === 'start' ? 1 : -1;
      let hit = 0, n = 0;
      for (let a = 12; a <= 80; a += 4) {
        const r = (a * Math.PI) / 180;
        const p = toImg(l, h + dir * w * Math.cos(r), side * w * Math.sin(r));
        n++; if (ink(p.x, p.y)) hit++;
      }
      if (hit / n > best.score) best = { score: hit / n, hinge, side, double: false };
    }
    // double (French) doors: two half-width arcs from both jambs on the same side
    for (const side of [1, -1] as const) {
      let hit = 0, n = 0;
      for (const [h, dir] of [[g0, 1], [g1, -1]] as const) for (let a = 12; a <= 80; a += 6) {
        const r = (a * Math.PI) / 180;
        const p = toImg(l, h + dir * (w / 2) * Math.cos(r), side * (w / 2) * Math.sin(r));
        n++; if (ink(p.x, p.y)) hit++;
      }
      if (hit / n > best.score + 0.1) best = { score: hit / n, hinge: 'start', side, double: true };
    }
    // window: unbroken thin parallel lines across the whole gap (checked pixel by pixel)
    let lineFrac = 0;
    for (const off of [-1, 0, 1]) {
      let on = 0, cnt = 0;
      for (let s = Math.ceil(g0) + 1; s < g1 - 1; s++) {
        const p = toImg(l, s, off);
        const xx = Math.round(p.x), yy = Math.round(p.y);
        cnt++;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && gray[yy * W + xx] < 215) on++;
      }
      if (cnt) lineFrac = Math.max(lineFrac, on / cnt);
    }
    // door leaves and swings put ink beside the gap, on the side the door opens to
    const sideInk = (side: 1 | -1) => {
      let on = 0, n = 0;
      for (let s = Math.ceil(g0); s <= g1; s++) for (let d = 2; d <= Math.max(3, w * 0.6); d++) {
        const p = toImg(l, s, side * d);
        const xx = Math.round(p.x), yy = Math.round(p.y);
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        n++;
        if (gray[yy * W + xx] < 215) on++;
      }
      return n ? on / n : 0;
    };
    const inkPos = sideInk(1), inkNeg = sideInk(-1);
    let kind: DetectedOpening['kind'] = 'opening';
    let conf = 0.35;
    if (lineFrac >= 0.85 && best.score < 0.55) { kind = 'window'; conf = 0.5 + 0.4 * lineFrac; }
    else if (best.score >= 0.55) { kind = 'door'; conf = Math.min(1, best.score); }
    else if (Math.max(inkPos, inkNeg) >= 0.025) {
      kind = 'door';
      conf = 0.45;
      best = { ...best, side: inkPos >= inkNeg ? 1 : -1, double: w > px(1300) };
    }
    return { kind, conf, ...best };
  };


  // --- 3. join collinear segments; doorway-sized gaps become openings
  const maxGap = px(1900); // any gap up to this joins
  const maxEvidencedGap = px(3800); // wider gaps join only if a door swing or window is drawn there
  const minOpen = px(550);
  interface Line { horiz: boolean; c: number; s0: number; s1: number; t: number; gaps: [number, number][] }
  const lines: Line[] = [];
  for (const horiz of [true, false]) {
    const list = segs.filter((s) => s.horiz === horiz).sort((a, b) => a.c - b.c || a.s0 - b.s0);
    const used = new Set<Seg>();
    for (const s of list) {
      if (used.has(s)) continue;
      // exterior walls are often drawn as a double line, so allow a little sideways wander
      const group = list.filter((q) => !used.has(q) && Math.abs(q.c - s.c) <= Math.max(2.6, strokePx * 1.5, px(160)));
      group.sort((a, b) => a.s0 - b.s0);
      let cur: Line | null = null;
      for (const q of group) {
        used.add(q);
        const gap = cur ? q.s0 - cur.s1 : Infinity;
        const evidenced = () => { const k = classify({ horiz, c: cur!.c }, cur!.s1, q.s0); return k.kind !== 'opening'; };
        if (cur && (gap <= maxGap || (gap <= maxEvidencedGap && evidenced()))) {
          if (q.s0 - cur.s1 >= minOpen) cur.gaps.push([cur.s1, q.s0]);
          cur.s1 = Math.max(cur.s1, q.s1);
          cur.t = Math.max(cur.t, q.t);
        } else {
          if (cur) lines.push(cur);
          cur = { horiz, c: q.c, s0: q.s0, s1: q.s1, t: q.t, gaps: [] };
        }
      }
      if (cur) lines.push(cur);
    }
  }
  // drop short pieces (usually text or symbols) unless they carry an opening
  let L = lines.filter((l) => l.s1 - l.s0 >= px(650) || l.gaps.length);

  // gaps at either end are not openings – trim lines that would start/end in a gap
  // --- 4. snap ends onto perpendicular walls (closes corners and T-junctions)
  const snap = Math.max(3, px(350));
  for (const l of L) {
    for (const end of ['s0', 's1'] as const) {
      let best: { d: number; v: number } | null = null;
      for (const m of L) {
        if (m.horiz === l.horiz) continue;
        // m is perpendicular: its constant coordinate is along l's axis
        if (l.c < m.s0 - snap || l.c > m.s1 + snap) continue;
        const d = Math.abs(m.c - l[end]);
        if (d <= snap && (!best || d < best.d)) best = { d, v: m.c };
      }
      if (best) l[end] = best.v;
    }
  }
  // Drop pieces that touch nothing: almost always bold text, symbols or furniture outlines.
  const touches = (l: Line, v: number) => L.some((m) => m !== l && (
    m.horiz !== l.horiz
      ? (Math.abs(m.c - v) <= snap && l.c >= m.s0 - snap && l.c <= m.s1 + snap) ||
        // a perpendicular wall meeting this one part-way along (T-junction)
        (m.c > l.s0 && m.c < l.s1 && (Math.abs(m.s0 - l.c) <= snap || Math.abs(m.s1 - l.c) <= snap))
      : Math.abs(m.c - l.c) <= snap * 2 && (Math.abs(m.s0 - v) <= snap || Math.abs(m.s1 - v) <= snap)));
  L = L.filter((l) => {
    const len = l.s1 - l.s0;
    if (len < px(300)) return false;
    const n = (touches(l, l.s0) ? 1 : 0) + (touches(l, l.s1) ? 1 : 0);
    return n > 0 || len >= px(2200);
  });

  const walls: DetectedWall[] = [];
  const openings: DetectedOpening[] = [];
  const doorGaps: number[] = [];
  for (const l of L) {
    const idx = walls.length;
    walls.push({ a: toImg(l, l.s0, 0), b: toImg(l, l.s1, 0), thicknessPx: Math.max(1, l.t) });
    for (const [g0, g1] of l.gaps) {
      const w = g1 - g0;
      const k = classify(l, g0, g1);
      const best = k, kind = k.kind, conf = k.conf;
      // swing side in Opening convention: relative to the wall's left-hand normal
      // horizontal a→b (+x): normal = +y ; vertical a→b (+y): normal = -x
      const swingSide = (l.horiz ? best.side : -best.side) as 1 | -1;
      openings.push({ wall: idx, offsetPx: (g0 + g1) / 2 - l.s0, widthPx: w, kind, hinge: best.hinge, swingSide, confidence: conf });
      if (kind === 'door' && !best.double) doorGaps.push(w);
    }
  }
  const md = median(doorGaps);
  return { walls, openings, strokePx, scaleFromDoors: doorGaps.length >= 2 && md > 0 ? 840 / md : undefined };
};
