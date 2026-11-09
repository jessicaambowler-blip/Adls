import { catalogueEntry, itemLabel } from './catalogue';
import { add, clearOpening, dist, layoutBounds, wallPoint } from './geometry';
import type { Layout, Vec2 } from './types';

/** Move one wall by a vector, dragging any connected wall endpoints with it. */
export const moveWall = (l: Layout, wallId: string, v: Vec2) => {
  const w = l.walls.find((x) => x.id === wallId);
  if (!w) return;
  const a0 = { ...w.a }, b0 = { ...w.b };
  for (const x of l.walls) {
    for (const end of ['a', 'b'] as const) {
      if (dist(x[end], a0) < 2 || dist(x[end], b0) < 2) x[end] = add(x[end], v);
    }
  }
};

/** If the room is a simple axis-aligned rectangle, return its walls and internal size. */
export const rectInfo = (l: Layout) => {
  if (l.walls.length !== 4) return null;
  const vert = l.walls.filter((w) => Math.abs(w.a.x - w.b.x) < 1);
  const horz = l.walls.filter((w) => Math.abs(w.a.y - w.b.y) < 1);
  if (vert.length !== 2 || horz.length !== 2) return null;
  const [left, right] = vert.sort((p, q) => p.a.x - q.a.x);
  const [top, bottom] = horz.sort((p, q) => p.a.y - q.a.y);
  const t = left.thickness;
  return { left, right, top, bottom, width: Math.round(right.a.x - left.a.x - t), depth: Math.round(bottom.a.y - top.a.y - t) };
};

export const setRoomSize = (l: Layout, width?: number, depth?: number) => {
  const r = rectInfo(l);
  if (!r) return;
  if (width !== undefined) moveWall(l, r.right.id, { x: width - r.width, y: 0 });
  if (depth !== undefined) moveWall(l, r.bottom.id, { x: 0, y: depth - r.depth });
};

export interface Change { what: string; detail: string }

/** Plain-language differences between two layouts (matched by id). */
export const diffLayouts = (a: Layout, b: Layout): Change[] => {
  const out: Change[] = [];
  const ra = rectInfo(a), rb = rectInfo(b);
  if (ra && rb && (ra.width !== rb.width || ra.depth !== rb.depth)) out.push({ what: 'Room size', detail: `${ra.width} × ${ra.depth} mm → ${rb.width} × ${rb.depth} mm` });
  const ba = layoutBounds({ ...a, items: [] }), bb = layoutBounds({ ...b, items: [] });
  if (!ra || !rb) {
    if (Math.abs(ba.maxX - ba.minX - (bb.maxX - bb.minX)) > 5 || Math.abs(ba.maxY - ba.minY - (bb.maxY - bb.minY)) > 5) out.push({ what: 'Room outline', detail: 'Walls have been moved' });
  }
  for (const wb of b.walls) {
    const wa = a.walls.find((w) => w.id === wb.id);
    if (!wa) continue;
    if (!ra && (dist(wa.a, wb.a) > 5 || dist(wa.b, wb.b) > 5)) out.push({ what: 'Wall moved', detail: `by about ${Math.round(Math.max(dist(wa.a, wb.a), dist(wa.b, wb.b)))} mm` });
  }
  // doors and windows: by id, else the nearest one in the other layout (within 1.2 m)
  const centre = (l: Layout, o: Layout['openings'][number]) => { const w = l.walls.find((x) => x.id === o.wallId); return w ? wallPoint(w, o.offset) : null; };
  const usedO = new Set<string>();
  const kindName0 = (k: string) => (k === 'window' ? 'Window' : k === 'opening' ? 'Opening' : k === 'sliding-door' ? 'Sliding door' : 'Door');
  // "Bedroom 1 door": named after the nearest room name on the plan
  const roomNear = (p: { x: number; y: number } | null) => {
    if (!p) return '';
    // a door between a room and the hallway is the room's door
    let best = '', bd = 3500;
    for (const lb of b.labels ?? a.labels ?? []) {
      const d = dist(lb, p) + (/hall/i.test(lb.text) ? 2500 : 0);
      if (d < bd) { bd = d; best = lb.text; }
    }
    return best;
  };
  let here = '';
  const kindName = (k: string) => (here ? `${here} ${kindName0(k).toLowerCase()}` : kindName0(k));
  for (const ob of b.openings) {
    here = roomNear(centre(b, ob));
    let oa = a.openings.find((o) => o.id === ob.id);
    const cb = centre(b, ob);
    if (!oa && cb) {
      let bd = 1200;
      for (const o of a.openings) {
        if (usedO.has(o.id) || (o.kind === 'window') !== (ob.kind === 'window')) continue;
        const ca = centre(a, o);
        if (ca && dist(ca, cb) < bd) { bd = dist(ca, cb); oa = o; }
      }
    }
    const name = kindName(ob.kind);
    if (!oa) { out.push({ what: `${name} added`, detail: `${ob.width} mm wide` }); continue; }
    usedO.add(oa.id);
    if (oa.width !== ob.width) out.push({ what: `${kindName(oa.kind)} width`, detail: `${oa.width} → ${ob.width} mm (clear opening about ${clearOpening(oa)} → ${clearOpening(ob)} mm)` });
    if (oa.kind !== ob.kind) out.push({ what: `${kindName(oa.kind)} type`, detail: `${kindName0(oa.kind).toLowerCase()} → ${kindName0(ob.kind).toLowerCase()}` });
    const ca = centre(a, oa);
    if (ca && cb && dist(ca, cb) > 5) out.push({ what: `${name} moved`, detail: `about ${Math.round(dist(ca, cb))} mm` });
    if (oa.kind === ob.kind && (oa.swingSide !== ob.swingSide || oa.hinge !== ob.hinge)) out.push({ what: `${name} swing`, detail: 'Hinge side or swing direction changed' });
  }
  for (const oa of a.openings) if (!usedO.has(oa.id) && !b.openings.some((o) => o.id === oa.id)) { here = roomNear(centre(a, oa)); out.push({ what: `${kindName(oa.kind)} removed`, detail: `${oa.width} mm` }); }
  // items: the same item (by id), else the nearest unmatched one of the same kind (layouts built
  // separately, e.g. the demo house, don't share ids)
  const used = new Set<string>();
  const matchItem = (ib: (typeof b.items)[number]) => {
    const byId = a.items.find((i) => i.id === ib.id);
    if (byId) return byId;
    let best: (typeof a.items)[number] | undefined;
    for (const ia of a.items) {
      if (ia.kind !== ib.kind || used.has(ia.id) || b.items.some((x) => x.id === ia.id)) continue;
      if (dist(ia, ib) < 1500 && (!best || dist(ia, ib) < dist(best, ib))) best = ia;
    }
    return best;
  };
  for (const ib of b.items) {
    const ia = matchItem(ib);
    const name = itemLabel(ib.kind, ib.label);
    if (!ia) {
      const detail = ib.ramp ? `${ib.w} mm wide, rise ${ib.ramp.rise} mm at 1:${ib.ramp.gradient}, ${ib.d} mm long incl. ${ib.ramp.landing} mm landing, handrails ${ib.ramp.rails === 'both' ? 'both sides' : ib.ramp.rails}`
        : ib.kind.startsWith('grab-rail') ? `${ib.w} mm${ib.kind === 'grab-rail-l' ? ` × ${ib.h} mm L-shaped` : ''}, ${ib.elevation ?? 800} mm above floor${roomNear(ib) ? ` (${roomNear(ib)})` : ''}`
        : `${ib.w} × ${ib.d} mm${roomNear(ib) ? ` (${roomNear(ib)})` : ''}`;
      out.push({ what: `${name} added`, detail });
      continue;
    }
    used.add(ia.id);
    const moved = dist(ia, ib);
    if (moved > 5) out.push({ what: `${name} moved`, detail: `${Math.round(moved)} mm` });
    if (ia.rotation !== ib.rotation) out.push({ what: `${name} rotated`, detail: `${ia.rotation}° → ${ib.rotation}°` });
    if (ia.w !== ib.w || ia.d !== ib.d || ia.h !== ib.h) out.push({ what: `${name} resized`, detail: `${ia.w}×${ia.d}×${ia.h} → ${ib.w}×${ib.d}×${ib.h} mm` });
    if ((ia.elevation ?? 0) !== (ib.elevation ?? 0)) out.push({ what: `${name} height`, detail: `${ia.elevation ?? 0} → ${ib.elevation ?? 0} mm above floor` });
  }
  for (const ia of a.items) if (!used.has(ia.id) && !b.items.some((i) => i.id === ia.id)) out.push({ what: `${itemLabel(ia.kind, ia.label)} removed`, detail: '' });
  if (a.floor !== b.floor) out.push({ what: 'Floor finish', detail: `${a.floor} → ${b.floor}` });
  return out;
};

export const defaultElevation = (kind: Parameters<typeof catalogueEntry>[0]) => catalogueEntry(kind)?.elevation;
