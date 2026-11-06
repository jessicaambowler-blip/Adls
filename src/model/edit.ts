import { catalogueEntry, itemLabel } from './catalogue';
import { add, clearOpening, dist, layoutBounds } from './geometry';
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
  for (const ob of b.openings) {
    const oa = a.openings.find((o) => o.id === ob.id);
    const name = ob.kind === 'window' ? 'Window' : ob.kind === 'opening' ? 'Opening' : 'Door';
    if (!oa) { out.push({ what: `${name} added`, detail: `${ob.width} mm wide` }); continue; }
    if (oa.width !== ob.width) out.push({ what: `${name} width`, detail: `${oa.width} → ${ob.width} mm (clear opening about ${clearOpening(oa)} → ${clearOpening(ob)} mm)` });
    if (oa.kind !== ob.kind) out.push({ what: `${name} type`, detail: `${oa.kind} → ${ob.kind}` });
    if (Math.abs(oa.offset - ob.offset) > 5) out.push({ what: `${name} moved`, detail: `${Math.round(Math.abs(oa.offset - ob.offset))} mm along the wall` });
    if (oa.swingSide !== ob.swingSide || oa.hinge !== ob.hinge) out.push({ what: `${name} swing`, detail: 'Hinge side or swing direction changed' });
  }
  for (const oa of a.openings) if (!b.openings.find((o) => o.id === oa.id)) out.push({ what: 'Opening removed', detail: `${oa.width} mm ${oa.kind}` });
  for (const ib of b.items) {
    const ia = a.items.find((i) => i.id === ib.id);
    const name = itemLabel(ib.kind, ib.label);
    if (!ia) { out.push({ what: `${name} added`, detail: `${ib.w} × ${ib.d} mm` }); continue; }
    const moved = dist(ia, ib);
    if (moved > 5) out.push({ what: `${name} moved`, detail: `${Math.round(moved)} mm` });
    if (ia.rotation !== ib.rotation) out.push({ what: `${name} rotated`, detail: `${ia.rotation}° → ${ib.rotation}°` });
    if (ia.w !== ib.w || ia.d !== ib.d || ia.h !== ib.h) out.push({ what: `${name} resized`, detail: `${ia.w}×${ia.d}×${ia.h} → ${ib.w}×${ib.d}×${ib.h} mm` });
    if ((ia.elevation ?? 0) !== (ib.elevation ?? 0)) out.push({ what: `${name} height`, detail: `${ia.elevation ?? 0} → ${ib.elevation ?? 0} mm above floor` });
  }
  for (const ia of a.items) if (!b.items.find((i) => i.id === ia.id)) out.push({ what: `${itemLabel(ia.kind, ia.label)} removed`, detail: '' });
  if (a.floor !== b.floor) out.push({ what: 'Floor finish', detail: `${a.floor} → ${b.floor}` });
  return out;
};

export const defaultElevation = (kind: Parameters<typeof catalogueEntry>[0]) => catalogueEntry(kind)?.elevation;
