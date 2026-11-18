import { roomAround } from './place';
import type { FloorFinish, Layout, PlanLabel, RoomFinish, Vec2, Wall } from './types';
import { wallNormal } from './geometry';
import { isInside } from './ground';

// Interior finishes: each named room can have its own floor, wall colour, tiles, ceiling and
// lights; each face of a wall can be painted on its own. Anything not set follows the house.

export const FLOOR_OPTIONS: { value: FloorFinish; label: string }[] = [
  { value: 'timber', label: 'Timber' }, { value: 'carpet', label: 'Carpet' }, { value: 'vinyl', label: 'Vinyl' }, { value: 'tiles', label: 'Tiles' }, { value: 'concrete', label: 'Concrete' },
];

export const WALL_COLOURS = ['#f4f2ee', '#ece6dc', '#efe3d0', '#e8dfd3', '#dfe6e3', '#d9e1ea', '#c9d6c3', '#b9cbd9', '#e6c9b5', '#8fa3ad', '#5f6f63', '#3e4a5c'];
export const FLOOR_COLOURS: Partial<Record<FloorFinish, string[]>> = {
  carpet: ['#968c80', '#6f7783', '#8b7d6b', '#5c6b5a', '#a99c8c', '#4f4a52'],
  vinyl: ['#c4beb2', '#a9b0b3', '#d6cdbd', '#8d9690', '#b7a58e'],
  tiles: ['#d6d4ce', '#ece9e2', '#9ea3a6', '#c9b9a3', '#5d6164'],
  timber: ['#a8784e', '#c49a6c', '#7a5236', '#d2b48c'],
  concrete: ['#b9b7b2', '#9a9894'],
};
export const CEILING_COLOURS = ['#f6f5f2', '#fbf8f0', '#eef1f3', '#e9e4da'];
export const LIGHT_OPTIONS: { value: NonNullable<RoomFinish['lights']>; label: string }[] = [
  { value: 'downlights', label: 'Downlights' }, { value: 'pendant', label: 'Pendant' }, { value: 'batten', label: 'Batten' }, { value: 'none', label: 'None' },
];

export interface Room { label: PlanLabel; rect: { x0: number; x1: number; y0: number; y1: number } }

/**
 * Every named room with the rectangle it fills (rooms whose walls can't be found are left out).
 * Open-plan spaces with more than one name are shared out between them: the cut goes at the end of a
 * wall between the two names if there is one (where the kitchen bench wall stops, say), otherwise halfway.
 */
export const roomsOf = (l: Layout): Room[] => {
  const labels = l.labels ?? [];
  const ends = l.walls.flatMap((w) => [{ ...w.a, w }, { ...w.b, w }]);
  return labels.flatMap((label) => {
    const rect = roomAround(l, label);
    if (!rect || rect.x1 - rect.x0 < 300 || rect.y1 - rect.y0 < 300 || rect.x1 - rect.x0 > 30000 || rect.y1 - rect.y0 > 30000) return [];
    const r = { ...rect };
    const others = labels.filter((o) => o !== label).sort((a, b) => Math.hypot(a.x - label.x, a.y - label.y) - Math.hypot(b.x - label.x, b.y - label.y));
    for (const o of others) {
      if (o.x <= r.x0 || o.x >= r.x1 || o.y <= r.y0 || o.y >= r.y1) continue;
      const alongX = Math.abs(o.x - label.x) >= Math.abs(o.y - label.y);
      const a = alongX ? label.x : label.y, b = alongX ? o.x : o.y, mid = (a + b) / 2;
      let cut = mid;
      for (const e of ends) {
        // a wall ending inside the space, or one running along its edge that stops short (not one
        // that only meets the edge from outside, like the wall between two bedrooms off a hall)
        const across = alongX ? e.y : e.x, lo = alongX ? r.y0 : r.x0, hi = alongX ? r.y1 : r.x1;
        if (across < lo - 120 || across > hi + 120) continue;
        const along = Math.abs(alongX ? e.w.b.x - e.w.a.x : e.w.b.y - e.w.a.y) > Math.abs(alongX ? e.w.b.y - e.w.a.y : e.w.b.x - e.w.a.x);
        if ((across < lo + 100 || across > hi - 100) && !along) continue;
        // (a wall split into pieces carries on: only a real end counts)
        const horiz = (w: Wall) => Math.abs(w.b.x - w.a.x) > Math.abs(w.b.y - w.a.y);
        if (l.walls.some((w) => w !== e.w && horiz(w) === horiz(e.w) && [w.a, w.b].some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 5))) continue;
        const v = alongX ? e.x : e.y;
        if ((v - a) * (v - b) < 0 && Math.abs(v - a) > 400 && Math.abs(v - b) > 400 && Math.abs(v - mid) < Math.abs(cut - mid) + (cut === mid ? Infinity : 0)) cut = v;
      }
      if (alongX) { if (b > a) r.x1 = cut; else r.x0 = cut; } else if (b > a) r.y1 = cut; else r.y0 = cut;
    }
    return [{ label, rect: r }];
  });
};

/** The (smallest) named room a point is in. */
export const roomAt = (rooms: Room[], p: Vec2): Room | undefined => {
  let best: Room | undefined, area = Infinity;
  for (const r of rooms) {
    const { x0, x1, y0, y1 } = r.rect;
    if (p.x < x0 - 1 || p.x > x1 + 1 || p.y < y0 - 1 || p.y > y1 + 1) continue;
    const a = (x1 - x0) * (y1 - y0);
    if (a < area) { area = a; best = r; }
  }
  return best;
};

export interface Finish { floor: FloorFinish; floorColour?: string; wallColour: string; wallTiles: 'none' | 'half' | 'full'; ceilingColour: string; ceiling: 'plain' | 'timber'; lights: NonNullable<RoomFinish['lights']> }

/** A room's finishes with the house defaults filled in. */
export const finishOf = (l: Layout, f?: RoomFinish): Finish => {
  const floor = f?.floor ?? l.floor;
  return {
    floor,
    floorColour: f?.floorColour,
    wallColour: f?.wallColour ?? l.wallColor,
    // tiled floors have tiled walls unless the room says otherwise (wet areas)
    wallTiles: f?.wallTiles ?? (floor === 'tiles' ? 'full' : 'none'),
    ceilingColour: f?.ceilingColour ?? '#f6f5f2',
    ceiling: f?.ceiling ?? 'plain',
    lights: f?.lights ?? 'downlights',
  };
};

/** What a face of a wall looks like: side 0 faces along the wall's normal, side 1 the other way. */
export const wallFace = (l: Layout, rooms: Room[], w: Wall, side: 0 | 1, at: Vec2) => {
  const n = wallNormal(w), s = side === 0 ? 1 : -1, off = w.thickness / 2 + 120;
  const p = { x: at.x + n.x * s * off, y: at.y + n.y * s * off };
  const room = roomAt(rooms, p);
  // outside faces: paint only; inside but not in a named room: the house finishes
  const f = room ? finishOf(l, room.label.finish) : isInside(l, p) ? finishOf(l) : null;
  const paint = w.paint?.[side] ?? null;
  return { room, outside: !f, colour: paint ?? f?.wallColour ?? l.wallColor, tiles: f?.wallTiles ?? ('none' as const), painted: !!paint };
};

/** The name to show for a face of a wall. */
export const faceName = (l: Layout, w: Wall, side: 0 | 1) => {
  const at = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  const f = wallFace(l, roomsOf(l), w, side, at);
  return f.room?.label.text ?? (f.outside ? 'Outside' : 'This side');
};
