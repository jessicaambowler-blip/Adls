import { CATALOGUE } from './catalogue';
import { uid } from './geometry';
import type { Item, ItemKind, Layout, Opening, Project, Wall } from './types';

const T = 110; // typical internal stud wall thickness incl. plasterboard (mm)

export const makeItem = (kind: ItemKind, x: number, y: number, rotation = 0, over: Partial<Item> = {}): Item => {
  const c = CATALOGUE.find((e) => e.kind === kind)!;
  return { id: uid('item'), kind, x, y, rotation, w: c.w, d: c.d, h: c.h, elevation: c.elevation, ...over };
};

/** A rectangular room with INTERNAL dimensions W × D mm, internal corner at (0,0). */
export const rectWalls = (W: number, D: number, t = T): Wall[] => {
  const h = t / 2;
  return [
    { id: uid('wall'), a: { x: -h, y: -h }, b: { x: W + h, y: -h }, thickness: t }, // top
    { id: uid('wall'), a: { x: W + h, y: -h }, b: { x: W + h, y: D + h }, thickness: t }, // right
    { id: uid('wall'), a: { x: W + h, y: D + h }, b: { x: -h, y: D + h }, thickness: t }, // bottom
    { id: uid('wall'), a: { x: -h, y: D + h }, b: { x: -h, y: -h }, thickness: t }, // left
  ];
};

const door = (wall: Wall, offset: number, width = 820, over: Partial<Opening> = {}): Opening => ({
  id: uid('open'), wallId: wall.id, kind: 'door', offset, width, height: 2040, sill: 0, swingSide: 1, hinge: 'start', ...over,
});
const windowOn = (wall: Wall, offset: number, width = 1200, over: Partial<Opening> = {}): Opening => ({
  id: uid('open'), wallId: wall.id, kind: 'window', offset, width, height: 1200, sill: 900, swingSide: 1, hinge: 'start', ...over,
});

const base = (name: string, over: Partial<Layout>): Layout => ({
  name,
  walls: [],
  openings: [],
  items: [],
  floor: 'timber',
  wallColor: '#ece6dc',
  ceilingHeight: 2400,
  start: { x: 0, y: 0, heading: 180 },
  end: { x: 0, y: 0 },
  ...over,
});

export const bedroomTemplate = (W = 3800, D = 3400): Layout => {
  const walls = rectWalls(W, D);
  const [top, right, bottom] = walls;
  const bed = makeItem('bed-queen', W / 2 - 300, 2030 / 2);
  const items = [
    bed,
    makeItem('bedside-table', bed.x - bed.w / 2 - 260, 230),
    makeItem('bedside-table', bed.x + bed.w / 2 + 260, 230),
    makeItem('wardrobe', 300, 1900, -90, { w: 1800 }),
    makeItem('drawers', W - 225, 1500, 90, { w: 900 }),
    makeItem('rug', bed.x, 1900, 0, { w: 1400, d: 900 }),
  ];
  const doorX = W - 520;
  return base('Bedroom', {
    walls,
    openings: [door(bottom, W + T / 2 - doorX, 820, { hinge: 'end' }), windowOn(right, 900, 1500)],
    items,
    floor: 'timber',
    start: { x: doorX, y: D + 900, heading: 180 },
    end: { x: bed.x + bed.w / 2 + 500, y: 1500 },
    targetItemId: bed.id,
  });
  void top;
};

export const bathroomTemplate = (W = 2400, D = 2700): Layout => {
  const walls = rectWalls(W, D);
  const [top, , bottom, left] = walls;
  const toilet = makeItem('toilet', W - 450, 350);
  const items = [
    toilet,
    makeItem('grab-rail', W - 40, 600, 90, { w: 900 }),
    makeItem('basin', 1150, 225),
    makeItem('shower', 580, D - 600, 0, { w: 1160, d: 1200 }),
    makeItem('grab-rail', 30, D - 600, -90, { w: 700, elevation: 900 }),
  ];
  return base('Bathroom', {
    walls,
    openings: [door(bottom, W + T / 2 - (W - 600), 820, { hinge: 'end' }), windowOn(left, D + T / 2 - 700, 700, { sill: 1400, height: 600 })],
    items,
    floor: 'tiles',
    wallColor: '#f1f1ee',
    start: { x: W - 600, y: D + 900, heading: 180 },
    end: { x: W - 900, y: 1200 },
    targetItemId: toilet.id,
  });
  void top;
};

export const hallwayTemplate = (): Layout => {
  // Corridor 1000 mm wide (internal) running north–south, opening into two rooms.
  const C = 1000;
  const W = 4200;
  const D = 5200;
  const h = T / 2;
  const outer = rectWalls(W, D);
  const [, , bottom] = outer;
  const split1: Wall = { id: uid('wall'), a: { x: C + h, y: -h }, b: { x: C + h, y: 2600 }, thickness: T };
  const split2: Wall = { id: uid('wall'), a: { x: C + h, y: 2600 }, b: { x: C + h, y: D + h }, thickness: T };
  const cross: Wall = { id: uid('wall'), a: { x: C + h, y: 2600 }, b: { x: W + h, y: 2600 }, thickness: T };
  const bed = makeItem('bed-single', 2600, 2600 + h + 1880 / 2);
  return base('Hallway and bedroom', {
    walls: [...outer, split1, split2, cross],
    openings: [
      { ...door(bottom, W + h - C / 2, 900), kind: 'opening' as const },
      door(split1, 1200, 820, { swingSide: -1 }),
      door(split2, 1500, 820, { swingSide: -1, hinge: 'end' }),
    ],
    items: [
      makeItem('hall-table', 175, 1500, -90, { w: 900 }),
      makeItem('plant', 220, 300),
      bed,
      makeItem('bedside-table', 2600 + 920 / 2 + 260, 2600 + h + 230),
      makeItem('desk', 2800, 330, 0, { w: 1200 }),
    ],
    floor: 'timber',
    start: { x: C / 2, y: D + 800, heading: 180 },
    end: { x: 2600 - 920 / 2 - 450, y: 4000 },
    targetItemId: bed.id,
  });
};

export const kitchenTemplate = (W = 3600, D = 3200): Layout => {
  const walls = rectWalls(W, D);
  const [top, right, bottom] = walls;
  return base('Kitchen', {
    walls,
    openings: [door(bottom, W + T / 2 - 700, 870, { kind: 'opening' }), windowOn(top, W / 2 + T / 2, 1500, { sill: 1050, height: 1000 })],
    items: [
      makeItem('kitchen-bench', W / 2, 300, 0, { w: 2600 }),
      makeItem('fridge', W - 350, 1250, 90),
      makeItem('dining-table', 1300, 2100),
    ],
    floor: 'vinyl',
    start: { x: W - 700, y: D + 900, heading: 180 },
    end: { x: W / 2, y: 1250 },
  });
  void right;
};

export const blankRoom = (W: number, D: number, name = 'Room'): Layout => {
  const walls = rectWalls(W, D);
  return base(name, {
    walls,
    openings: [door(walls[2], W + T / 2 - W / 2, 870)],
    start: { x: W / 2, y: D + 900, heading: 180 },
    end: { x: W / 2, y: D / 2 },
  });
};

export const TEMPLATES = [
  { id: 'bedroom', label: 'Bedroom', make: () => bedroomTemplate() },
  { id: 'bathroom', label: 'Bathroom', make: () => bathroomTemplate() },
  { id: 'hallway', label: 'Hallway + rooms', make: () => hallwayTemplate() },
  { id: 'kitchen', label: 'Kitchen', make: () => kitchenTemplate() },
];

export const defaultProject = (): Project => {
  const existing = bedroomTemplate();
  return {
    version: 1,
    title: 'Home modification session',
    consumerName: '',
    otName: '',
    layouts: { existing, proposed: cloneLayout(existing, 'Proposed') },
    activity: {
      type: 'bed-transfer',
      chair: 'manual',
      supportPerson: false,
      transferSide: 'auto',
      showSweptPath: true,
      persona: { name: 'Alex', heightCm: 175, skin: '#c99a7a', hair: '#3b2a20', top: '#3d6e8f', bottoms: '#2f3440' },
    },
    notes: [],
  };
};

/** Deep copy that KEEPS ids (so existing/proposed items can be compared). */
export const cloneLayout = (l: Layout, name?: string): Layout => ({ ...JSON.parse(JSON.stringify(l)), name: name ?? l.name });
