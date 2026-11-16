import { clearOpening, layoutBounds, layoutCentre, wallPoint } from './geometry';
import { roomAround } from './place';
import { obstaclesOf } from './pathfinding';
import type { Layout, Vec2 } from './types';

// Clearance guides: is there room to turn the client's wheelchair in each room, and is each doorway
// wide enough for it? A visual guide for discussion, not a compliance check.

export type Status = 'ok' | 'tight' | 'no';

export interface TurnCheck { kind: 'turn'; room: string; at: Vec2; /** largest clear circle (mm, diameter) */ max: number; need: number; status: Status }
export interface DoorCheck { kind: 'door'; name: string; at: Vec2; clear: number; need: number; status: Status }
export type Check = TurnCheck | DoorCheck;

/** room for hands on the push rims / joystick beside the chair, on top of its width */
export const DOOR_MARGIN = 120;

const distToSeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const inside = (p: Vec2, poly: Vec2[]) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
};

/** Largest clear circle in a room (searching a 100 mm grid, then refining around the best spot). */
const biggestCircle = (polys: Vec2[][], r: { x0: number; x1: number; y0: number; y1: number }) => {
  const free = (p: Vec2) => {
    let d = Math.min(p.x - r.x0, r.x1 - p.x, p.y - r.y0, r.y1 - p.y);
    for (const poly of polys) {
      if (inside(p, poly)) return 0;
      for (let i = 0; i < poly.length && d > 0; i++) d = Math.min(d, distToSeg(p, poly[i], poly[(i + 1) % poly.length]));
    }
    return Math.max(0, d);
  };
  let best = { p: { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, d: 0 };
  for (let x = r.x0 + 50; x < r.x1; x += 100) for (let y = r.y0 + 50; y < r.y1; y += 100) {
    const d = free({ x, y });
    if (d > best.d) best = { p: { x, y }, d };
  }
  for (let x = best.p.x - 50; x <= best.p.x + 50; x += 25) for (let y = best.p.y - 50; y <= best.p.y + 50; y += 25) {
    const d = free({ x, y });
    if (d > best.d) best = { p: { x, y }, d };
  }
  return { at: best.p, diameter: Math.round((best.d * 2) / 10) * 10 };
};

export const checkClearances = (l: Layout, chair: { width: number; turn: number }): Check[] => {
  const out: Check[] = [];
  const polys = obstaclesOf(l).map((o) => o.poly);
  const rooms = (l.labels?.length ? l.labels : [{ text: 'Room', ...layoutCentre(l) }]).filter((r) => !/hall/i.test(r.text));
  for (const room of rooms) {
    const rect = roomAround(l, room);
    if (!rect || rect.x1 - rect.x0 < 500 || rect.y1 - rect.y0 < 500) continue;
    const c = biggestCircle(polys, rect);
    const status: Status = c.diameter >= chair.turn ? 'ok' : c.diameter >= chair.turn - 200 ? 'tight' : 'no';
    out.push({ kind: 'turn', room: room.text, at: c.at, max: c.diameter, need: chair.turn, status });
  }
  const need = chair.width + DOOR_MARGIN;
  const bounds = layoutBounds({ ...l, items: [] });
  for (const o of l.openings) {
    if (o.kind === 'window') continue;
    const w = l.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const at = wallPoint(w, o.offset);
    // name a doorway after the nearest room (not the hallway)
    let name = 'Doorway', bd = 3500;
    const b = bounds;
    const outside = Math.min(at.x - b.minX, b.maxX - at.x, at.y - b.minY, b.maxY - at.y) < 150;
    if (!outside) for (const lb of l.labels ?? []) { const d = Math.hypot(lb.x - at.x, lb.y - at.y) + (/hall/i.test(lb.text) ? 2500 : 0); if (d < bd) { bd = d; name = `${lb.text} door`; } }
    if (outside) name = 'Front door';
    const clear = clearOpening(o);
    out.push({ kind: 'door', name, at, clear, need, status: clear >= need ? 'ok' : clear >= chair.width + 40 ? 'tight' : 'no' });
  }
  return out;
};
