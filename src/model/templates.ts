import { CATALOGUE } from './catalogue';
import { uid } from './geometry';
import type { Item, ItemKind, Layout, Opening, Project, Wall } from './types';
import type { OriginalSceneData } from '../originals/originals';
import { splitAtJunctions } from './walls';

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

/**
 * A small low-set brick home (typical of 1980s–2000s Queensland): bedrooms and bathroom off a hallway,
 * open-plan living, kitchen and dining at the front. Internal envelope 11.0 × 10.0 m.
 * 'existing' has the usual barriers (720 mm doors, queen bed hard against furniture, a bath, a hall
 * table narrowing the hallway, a rug); 'proposed' shows typical modifications (920 mm doors, a sliding
 * bathroom door, a level-entry shower, a care bed with room for a hoist transfer, clutter removed).
 */
export const lowsetHouse = (variant: 'existing' | 'proposed'): Layout => {
  const W = 11000, D = 10000, h = T / 2;
  const P = variant === 'proposed';
  const outer = rectWalls(W, D);
  const [top, right, bottom, left] = outer;
  const wl = (ax: number, ay: number, bx: number, by: number): Wall => ({ id: uid('wall'), a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: T });
  const hallN = wl(-h, 4000, W + h, 4000); // bedrooms/bathroom | hallway
  const hallS = wl(6000, 5100, W + h, 5100); // hallway | kitchen (the living room is open to the hall)
  const bed1E = wl(4200, -h, 4200, 4000);
  const bathE = wl(6800, -h, 6800, 4000);
  const dw = P ? 920 : 720;
  const at = (wall: Wall, x: number) => x - wall.a.x; // offset along a west→east wall
  const openings: Opening[] = [
    door(hallN, at(hallN, P ? 3200 : 3600), P ? 1020 : dw, { swingSide: -1, hinge: 'end' }),
    P ? { ...door(hallN, at(hallN, 5300), 1020, { swingSide: 1 }), kind: 'sliding-door' as const } : door(hallN, at(hallN, 5300), dw, { swingSide: -1 }),
    door(hallN, at(hallN, 7500), dw, { swingSide: -1 }),
    { ...door(hallS, at(hallS, 9900), P ? 1000 : 820), kind: 'opening' as const },
    door(bottom, W + h - 4100, P ? 1020 : 820, { hinge: 'end' }),
    windowOn(top, 2100 + h, 1500),
    windowOn(top, 5500 + h, 600, { sill: 1400, height: 600 }),
    windowOn(top, 9000 + h, 1500),
    windowOn(bottom, W + h - 2300, 2400),
    windowOn(bottom, W + h - 8500, 1800),
    windowOn(right, 7700 + h, 1500, { sill: 1050, height: 1000 }),
    windowOn(left, D + h - 7500, 1500),
  ];
  const items: Item[] = [];
  // ---- main bedroom
  let bed: Item;
  if (P) {
    // care bed towards the east wall, leaving the west side clear for the wheelchair and hoist transfer
    bed = makeItem('bed-adjustable', 2950, 55 + 2150 / 2, 0, { label: 'Care bed' });
    items.push(bed, makeItem('bedside-table', 2950 + 500 + 260, 255), makeItem('wardrobe', 355, 3150, -90, { w: 1500 }));
  } else {
    bed = makeItem('bed-queen', 2100, 55 + 2030 / 2);
    items.push(
      bed,
      makeItem('bedside-table', 2100 - 765 - 250, 255),
      makeItem('bedside-table', 2100 + 765 + 250, 255),
      makeItem('wardrobe', 355, 2950, -90, { w: 1800 }),
      makeItem('drawers', 4145 - 225, 2900, 90, { w: 900 }),
    );
  }
  // ---- bathroom (x 4200–6800, y 0–4000)
  if (P) {
    items.push(
      makeItem('shower', 4255 + 640, 55 + 650, 0, { w: 1280, d: 1300 }),
      makeItem('toilet', 6745 - 350, 2100, 90),
      makeItem('grab-rail', 6745 - 40, 1450, 90, { w: 700 }),
      makeItem('basin', 4255 + 225, 2700, -90),
      makeItem('shower-commode', 5900, 900),
    );
  } else {
    items.push(
      makeItem('bath', 4255 + 840, 55 + 380),
      makeItem('toilet', 6745 - 350, 2100, 90),
      makeItem('vanity', 4255 + 240, 2600, -90),
    );
  }
  // ---- second bedroom (x 6800–11000, y 0–4000)
  items.push(makeItem('bed-single', 9800, 55 + 940), makeItem('bedside-table', 9800 - 460 - 250, 255), makeItem('desk', 7600, 355, 0, { w: 1200 }));
  // ---- hallway
  if (!P) items.push(makeItem('hall-table', 8300, 5100 - 55 - 175, 180, { w: 1000 }), makeItem('plant', 10700, 4600));
  // ---- living (x 0–6000, y 5100–10000)
  items.push(makeItem('tv-unit', 55 + 210, 7500, -90), makeItem('sofa', 2600, 7500, 90));
  items.push(P ? makeItem('armchair', 5300, 9150, 90) : makeItem('armchair', 1800, 9350, 180));
  if (!P) items.push(makeItem('rug', 1800, 7500, 90, { w: 2300, d: 1600 }));
  // ---- kitchen & dining (x 6000–11000, y 5100–10000)
  items.push(
    makeItem('kitchen-bench', W - 55 - 300, 7700, 90, { w: P ? 3000 : 3000 }),
    makeItem('fridge', W - 55 - 350, 5700, 90),
    makeItem('dining-table', 7700, 8700),
    makeItem('dining-chair', 7700 - 750 - 300, 8700, -90),
  );
  const house = base(P ? 'Low-set house – proposed' : 'Low-set house – existing', {
    walls: [...outer, hallN, hallS, bed1E, bathE],
    openings,
    items,
    floor: 'timber',
    wallColor: '#efebe4',
    start: { x: 3700, y: 8700, heading: 180 },
    end: { x: 8300, y: 6800 },
    targetItemId: bed.id,
  });
  // each room's stretch of a wall is its own piece, so it can be moved on its own
  splitAtJunctions(house);
  return house;
};

export const TEMPLATES = [
  { id: 'bedroom', label: 'Bedroom', make: () => bedroomTemplate() },
  { id: 'bathroom', label: 'Bathroom', make: () => bathroomTemplate() },
  { id: 'hallway', label: 'Hallway + rooms', make: () => hallwayTemplate() },
  { id: 'kitchen', label: 'Kitchen', make: () => kitchenTemplate() },
];

export const defaultProject = (): Project => {
  const existing = lowsetHouse('existing');
  return {
    version: 1,
    title: 'Home modification session',
    consumerName: '',
    otName: '',
    layouts: { existing, proposed: lowsetHouse('proposed') },
    activity: {
      type: 'bed-transfer',
      character: 'p2',
      bedMethod: 'hoist',
      chair: 'power',
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

/** The room an original VisADLs recording took place in (no walls in the original: an open floor). */
export const originalRoomTemplate = (scene: OriginalSceneData): Layout => {
  const [W, D] = scene.room;
  const P = (X: number, Y: number) => ({ x: (X + scene.offsetCm[0]) * 10, y: (Y + scene.offsetCm[1]) * 10 });
  // The recording's bed is replaced by a care bed from the catalogue, placed where she lay in the
  // original (centred on her across its width, head end where the original head end was); the
  // transfer is fitted to wherever this bed is moved (see fitToBed).
  const fit = scene.bedFit ?? { lateralX: 18, headEndY: scene.bedFootprint.maxY, rotation: 180 };
  const bedD = 2150, bedW = 1000;
  const c = P(fit.lateralX, fit.headEndY - bedD / 20);
  const bed = makeItem('bed-adjustable', Math.round(c.x), Math.round(c.y), fit.rotation, { label: 'Bed' });
  const t1 = P(fit.lateralX + bedW / 20 + 30, fit.headEndY - 12), t2 = P(fit.lateralX - bedW / 20 - 30, fit.headEndY - 12);
  const walls = rectWalls(W, D);
  const start = P(scene.person.track.data[0], scene.person.track.data[1]);
  return base(`Original room – ${scene.person.label}`, {
    walls,
    openings: [{ ...door(walls[2], W / 2, 1200), kind: 'opening' as const }],
    items: [
      bed,
      makeItem('bedside-table', Math.round(t1.x), Math.round(t1.y), 180),
      makeItem('bedside-table', Math.round(t2.x), Math.round(t2.y), 180),
    ],
    floor: 'vinyl',
    wallColor: '#f1efe9',
    start: { x: Math.round(start.x), y: Math.round(start.y), heading: 270 },
    end: { x: Math.round(c.x), y: Math.round(c.y) },
    targetItemId: bed.id,
  });
};
