// Run with: npm test
import assert from 'node:assert/strict';
import { lowsetHouse } from '../src/model/templates';
import { addRoom, addWalls, applyWallDrag, beginWallDrag, moveCorner, setWallLength, splitAtJunctions, splitWall } from '../src/model/walls';
import { wallLength, wallPoint } from '../src/model/geometry';
import type { Layout, Vec2 } from '../src/model/types';

const near = (p: Vec2, q: Vec2, msg: string) => assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 3, `${msg}: ${JSON.stringify(p)} vs ${JSON.stringify(q)}`);
const wallAt = (l: Layout, a: Vec2, b: Vec2) => l.walls.find((w) => (Math.hypot(w.a.x - a.x, w.a.y - a.y) < 3 && Math.hypot(w.b.x - b.x, w.b.y - b.y) < 3) || (Math.hypot(w.a.x - b.x, w.a.y - b.y) < 3 && Math.hypot(w.b.x - a.x, w.b.y - a.y) < 3));
const ends = (l: Layout) => l.walls.flatMap((w) => [w.a, w.b]);
const joined = (l: Layout, p: Vec2) => ends(l).filter((e) => Math.hypot(e.x - p.x, e.y - p.y) < 3).length;
let n = 0;
const test = (name: string, f: () => void) => { f(); n++; console.log('ok', name); };

test('T-junctions become joints', () => {
  const l = lowsetHouse('existing');
  // the house template already comes in pieces; splitting again changes nothing
  const before = l.walls.length;
  splitAtJunctions(l);
  assert.equal(l.walls.length, before);
  // the hallway wall is now in pieces meeting the bedroom/bathroom walls
  assert.ok(wallAt(l, { x: -55, y: 4000 }, { x: 4200, y: 4000 }), 'bedroom piece of the hallway wall');
  assert.ok(joined(l, { x: 4200, y: 4000 }) >= 3, 'three walls meet at the bedroom corner');
});

test('moving part of a wall makes a step and keeps doors with it', () => {
  const l = lowsetHouse('existing');
  splitAtJunctions(l);
  const piece = wallAt(l, { x: -55, y: 4000 }, { x: 4200, y: 4000 })!;
  const door = l.openings.find((o) => o.wallId === piece.id)!;
  assert.ok(door, 'bedroom door is on the bedroom piece');
  const doorBefore = wallPoint(piece, door.offset);
  const d = beginWallDrag(l, piece.id);
  // move it 300 mm into the hallway (down); the wall's normal decides the sign
  const nrm = { x: -(piece.b.y - piece.a.y) / wallLength(piece), y: (piece.b.x - piece.a.x) / wallLength(piece) };
  applyWallDrag(l, d, 300 * Math.sign(nrm.y));
  const moved = l.walls.find((w) => w.id === piece.id)!;
  assert.equal(Math.round(moved.a.y), 4300);
  assert.equal(Math.round(moved.b.y), 4300);
  // the bedroom side wall stretched to meet it
  assert.ok(wallAt(l, { x: 4200, y: -55 }, { x: 4200, y: 4300 }), 'bedroom side wall stretched');
  // the rest of the hallway wall stayed, with a step joining it
  assert.ok(wallAt(l, { x: 4200, y: 4000 }, { x: 6800, y: 4000 }), 'bathroom piece unchanged');
  assert.ok(wallAt(l, { x: 4200, y: 4000 }, { x: 4200, y: 4300 }), 'step wall added');
  // the outside wall still meets the moved piece
  assert.ok(joined(l, { x: -55, y: 4300 }) >= 3, 'outside wall follows');
  const doorAfter = wallPoint(moved, l.openings.find((o) => o.id === door.id)!.offset);
  near(doorAfter, { x: doorBefore.x, y: doorBefore.y + 300 }, 'door moved with the wall');
  // dragging back to 0 removes the step
  applyWallDrag(l, d, 0);
  assert.ok(!wallAt(l, { x: 4200, y: 4000 }, { x: 4200, y: 4000 }), 'no zero-length step');
});

test('split keeps openings in place', () => {
  const l = lowsetHouse('proposed');
  splitAtJunctions(l);
  const before = new Map(l.openings.map((o) => { const w = l.walls.find((x) => x.id === o.wallId)!; return [o.id, wallPoint(w, o.offset)]; }));
  for (const w of [...l.walls]) if (wallLength(w) > 3000) splitWall(l, w.id, wallPoint(w, wallLength(w) / 3));
  for (const o of l.openings) {
    const w = l.walls.find((x) => x.id === o.wallId)!;
    near(wallPoint(w, o.offset), before.get(o.id)!, `opening ${o.kind} ${o.width}`);
  }
});

test('drawing a wall joins onto walls it touches', () => {
  const l = lowsetHouse('existing');
  const count = l.walls.length;
  // a new wall across the living room from the outside wall to the hallway wall
  addWalls(l, [{ x: -55, y: 6000 }, { x: 2000, y: 6000 }]);
  assert.ok(l.walls.length >= count + 2, 'new wall added and the outside wall split');
  assert.ok(joined(l, { x: -55, y: 6000 }) >= 3, 'T-junction with the outside wall');
});

test('adding a room against existing walls does not double them', () => {
  const l = lowsetHouse('existing');
  splitAtJunctions(l);
  const before = l.walls.length;
  // a laundry in the corner of the kitchen: two sides on existing walls
  const added = addRoom(l, { x: 8500, y: 5100 }, { x: 11055, y: 7000 });
  assert.equal(added.length, 2, 'only the two new sides are added');
  assert.ok(l.walls.length >= before + 2);
});

test('corners and lengths', () => {
  const l = lowsetHouse('existing');
  splitAtJunctions(l);
  const side = wallAt(l, { x: 4200, y: -55 }, { x: 4200, y: 4000 })!;
  setWallLength(l, side.id, 4000 + 55 - 110 + 200);
  assert.ok(Math.abs(wallLength(l.walls.find((w) => w.id === side.id)!) - (4055 + 200)) < 3);
  moveCorner(l, { x: 4200, y: 4200 }, { x: 4300, y: 4200 });
  assert.ok(joined(l, { x: 4300, y: 4200 }) >= 1);
});

console.log(`${n} wall-editing tests passed`);
