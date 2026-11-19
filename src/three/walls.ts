import * as THREE from 'three';
import { layoutBounds, layoutCentre, wallDir, wallLength, wallNormal } from '../model/geometry';
import type { FloorFinish, Layout, Opening, Wall } from '../model/types';
import { M, boxOn, mesh, paint, rod, std } from './build';
import { vinylTexture } from './textures';
import { photoMaterial, type Photo } from './photoTextures';
import { roomsOf, wallFace, type Room } from '../model/finishes';

export interface WallBuild {
  wall: Wall;
  full: THREE.Group;
  low: THREE.Group;
  exterior: boolean;
  /** 3D direction pointing out of the building (only meaningful when exterior) */
  outward: THREE.Vector3;
  mid: THREE.Vector3;
}

const LOW = 0.32;

const capMat = std('#8f8a82', 0.9);
const skirtingMat = paint('#f7f6f2', 0.5);

// wall tiles: the floor-tile photo at half size (150 mm tiles), glossy
const tileMat = (len: number, h: number) => photoMaterial('tiles', len * 2, h * 2, { roughness: 0.3, normal: 0.5 });
// face brick on the outside of the house
const brickMat = (len: number, h: number) => photoMaterial('brick', len, h, { roughness: 0.9, normal: 1 });

/** height of a tiled splashback */
const HALF_TILES = 1.2;

/** Where along a wall (m) the rooms on either side change, so each stretch can take its room's finish. */
const roomCuts = (rooms: Room[], w: Wall) => {
  const d = wallDir(w), cuts: number[] = [];
  for (const r of rooms) {
    if (Math.abs(d.x) > 0.99) cuts.push((r.rect.x0 - w.a.x) / d.x / 1000, (r.rect.x1 - w.a.x) / d.x / 1000);
    else if (Math.abs(d.y) > 0.99) cuts.push((r.rect.y0 - w.a.y) / d.y / 1000, (r.rect.y1 - w.a.y) / d.y / 1000);
  }
  return cuts.sort((a, b) => a - b);
};

const piece = (layout: Layout, rooms: Room[], w: Wall, u0: number, u1: number, y0: number, y1: number, L: number, skirting: boolean, cuts: number[] = []): THREE.Group | null => {
  const inner = cuts.filter((c) => c > u0 + 0.02 && c < u1 - 0.02);
  if (inner.length) {
    const g = new THREE.Group();
    [u0, ...inner, u1].forEach((a, i, arr) => { if (i < arr.length - 1) { const p = piece(layout, rooms, w, a, arr[i + 1], y0, y1, L, skirting); if (p) g.add(p); } });
    return g;
  }
  const t = w.thickness / 1000;
  const ext0 = u0 <= 0.0001 ? t / 2 : 0;
  const ext1 = u1 >= L - 0.0001 ? t / 2 : 0;
  const len = u1 - u0 + ext0 + ext1;
  const h = y1 - y0;
  if (len <= 0.001 || h <= 0.001) return null;
  // each face takes the finish of the room it faces (or its own paint)
  const d = wallDir(w), um = ((u0 + u1) / 2) * 1000;
  const at = { x: w.a.x + d.x * um, y: w.a.y + d.y * um };
  const faces = ([0, 1] as const).map((side) => wallFace(layout, rooms, w, side, at));
  const mats = faces.map((f) => (f.painted ? paint(f.colour, 0.85) : f.outside ? brickMat(len, h) : f.tiles === 'full' ? tileMat(len, h) : paint(f.colour, 0.85)));
  const geo = new THREE.BoxGeometry(len, h, t);
  const m = new THREE.Mesh(geo, [mats[0], mats[0], capMat, mats[0], mats[0], mats[1]]);
  m.position.set(u0 - ext0 + len / 2, y0 + h / 2, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  faces.forEach((f, i) => {
    const s = i === 0 ? 1 : -1;
    // splashback tiles to 1200 mm
    if (f.tiles === 'half' && !f.painted && y0 < HALF_TILES) {
      const th = Math.min(y1, HALF_TILES) - y0;
      g.add(mesh(new THREE.BoxGeometry(len, th, 0.006), tileMat(len, th), [u0 - ext0 + len / 2, y0 + th / 2, s * (t / 2 + 0.003)]));
    }
    if (skirting && y0 === 0 && f.tiles === 'none') g.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.012), skirtingMat, [u0 - ext0 + len / 2, 0.035, s * (t / 2 + 0.006)]));
  });
  return g;
};

const doorLeaf = (o: Opening, t: number) => {
  const W = o.width / 1000;
  const H = o.height / 1000;
  const leafW = W - 0.06;
  const g = new THREE.Group();
  const leafMat = paint('#f4f2ee', 0.5);
  const leaf = boxOn(leafW, H - 0.02, 0.035, leafMat, leafW / 2, 0.01, 0, 0.004);
  g.add(leaf);
  // panel detail
  g.add(boxOn(leafW - 0.2, H * 0.35, 0.004, paint('#e9e7e2', 0.5), leafW / 2, H * 0.55, 0.019, 0.002));
  g.add(boxOn(leafW - 0.2, H * 0.35, 0.004, paint('#e9e7e2', 0.5), leafW / 2, H * 0.1, 0.019, 0.002));
  // lever handles both sides
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 16), M.chrome, [leafW - 0.06, 1.0, s * 0.022], [Math.PI / 2, 0, 0]));
    g.add(rod([leafW - 0.06, 1.0, s * 0.035], [leafW - 0.18, 1.0, s * 0.045], 0.009, M.chrome));
  }
  void t;
  return g;
};

const frameAround = (o: Opening, u: number, t: number, top: number, bottom = 0) => {
  const g = new THREE.Group();
  const W = o.width / 1000;
  const mat = paint('#f7f6f2', 0.5);
  const at = t + 0.03;
  // jambs & head
  g.add(boxOn(0.045, top - bottom, at, mat, u - W / 2 - 0.0225, bottom, 0, 0.003));
  g.add(boxOn(0.045, top - bottom, at, mat, u + W / 2 + 0.0225, bottom, 0, 0.003));
  g.add(boxOn(W + 0.09, 0.045, at, mat, u, top, 0, 0.003));
  return g;
};

export const buildWalls = (layout: Layout): WallBuild[] => {
  const ceiling = layout.ceilingHeight / 1000;
  const b = layoutBounds(layout);
  const c = layoutCentre(layout);
  const rooms = roomsOf(layout);
  const out: WallBuild[] = [];
  for (const w of layout.walls) {
    const L = wallLength(w) / 1000;
    const t = w.thickness / 1000;
    const cuts = roomCuts(rooms, w);
    const ops = layout.openings.filter((o) => o.wallId === w.id).sort((p, q) => p.offset - q.offset);
    const make = (maxH: number) => {
      const g = new THREE.Group();
      let u = 0;
      const add = (p: THREE.Group | null) => p && g.add(p);
      for (const o of ops) {
        const u0 = Math.max(0, (o.offset - o.width / 2) / 1000);
        const u1 = Math.min(L, (o.offset + o.width / 2) / 1000);
        const uc = o.offset / 1000;
        add(piece(layout, rooms, w, u, u0, 0, maxH, L, true, cuts));
        const head = (o.kind === 'window' ? o.sill + o.height : o.height) / 1000;
        if (head < maxH) add(piece(layout, rooms, w, u0, u1, head, maxH, L, false));
        if (o.kind === 'window') {
          const sill = o.sill / 1000;
          add(piece(layout, rooms, w, u0, u1, 0, Math.min(sill, maxH), L, true));
          if (maxH > sill) {
            const top = Math.min(head, maxH);
            const fr = new THREE.Group();
            const W = u1 - u0;
            fr.add(boxOn(W, 0.04, t + 0.06, paint('#f7f6f2', 0.5), uc, sill - 0.02, 0, 0.004));
            if (top > sill + 0.05) {
              const glass = mesh(new THREE.BoxGeometry(W - 0.06, top - sill - 0.04, 0.008), M.glass, [uc, (sill + top) / 2, 0]);
              glass.castShadow = false;
              fr.add(glass);
              for (const x of [u0 + 0.02, u1 - 0.02, uc]) fr.add(boxOn(0.04, top - sill, 0.05, M.aluminium, x, sill, 0, 0.003));
              if (top >= head - 0.001) fr.add(boxOn(W, 0.04, 0.05, M.aluminium, uc, head - 0.04, 0, 0.003));
              // light curtain on the inside
              fr.add(boxOn(0.25, top - sill + 0.2, 0.03, std('#e9e2d4', 0.95), u0 - 0.1, sill - 0.1, 0.09 * 1, 0.01));
            }
            g.add(fr);
          }
        } else if (maxH > 0.5) {
          g.add(frameAround(o, uc, t, Math.min(head, maxH)));
          if (o.kind === 'door') {
            const leaf = doorLeaf(o, t);
            const s = o.swingSide;
            const hingeU = o.hinge === 'start' ? u0 + 0.03 : u1 - 0.03;
            leaf.position.set(hingeU, 0, s * (t / 2));
            // open ~85°
            leaf.rotation.y = o.hinge === 'start' ? -s * THREE.MathUtils.degToRad(85) : Math.PI + s * THREE.MathUtils.degToRad(85);
            g.add(leaf);
          } else if (o.kind === 'sliding-door') {
            const leaf = doorLeaf(o, t);
            leaf.position.set(u1 - 0.02, 0, (t / 2 + 0.03) * o.swingSide);
            g.add(leaf);
            g.add(boxOn(o.width / 500 + 0.1, 0.05, 0.04, M.aluminium, u1, head, (t / 2 + 0.03) * o.swingSide, 0.003));
          }
        } else {
          // low (cut-away) wall: show a threshold strip so the opening still reads
          g.add(boxOn(u1 - u0, 0.006, t, M.aluminium, uc, 0, 0, 0));
        }
        u = Math.max(u, u1);
      }
      add(piece(layout, rooms, w, u, L, 0, maxH, L, true, cuts));
      // orient: local x along the wall, local z = wall normal
      const d = wallDir(w);
      g.position.set(w.a.x / 1000, 0, w.a.y / 1000);
      g.rotation.y = -Math.atan2(d.y, d.x);
      return g;
    };
    const tol = w.thickness + 5;
    const onEdge = (p: { x: number; y: number }) => p.x <= b.minX + tol || p.x >= b.maxX - tol || p.y <= b.minY + tol || p.y >= b.maxY - tol;
    const exterior = onEdge(w.a) && onEdge(w.b) && (Math.abs(w.a.x - w.b.x) < 1 ? Math.abs(w.a.x - b.minX) < tol || Math.abs(w.a.x - b.maxX) < tol : Math.abs(w.a.y - w.b.y) < 1 ? Math.abs(w.a.y - b.minY) < tol || Math.abs(w.a.y - b.maxY) < tol : true);
    const n = wallNormal(w);
    const midP = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const sign = Math.sign(n.x * (midP.x - c.x) + n.y * (midP.y - c.y)) || 1;
    out.push({
      wall: w,
      full: make(ceiling),
      low: make(LOW),
      exterior,
      outward: new THREE.Vector3(n.x * sign, 0, n.y * sign),
      mid: new THREE.Vector3(midP.x / 1000, 1, midP.y / 1000),
    });
  }
  return out;
};

/** floors: photographic textures (vinyl stays a generated speckle) */
const FLOOR_PHOTO: Partial<Record<FloorFinish, { photo: Photo; roughness: number }>> = {
  timber: { photo: 'timber', roughness: 0.55 }, tiles: { photo: 'tiles', roughness: 0.6 }, carpet: { photo: 'carpet', roughness: 1 }, concrete: { photo: 'concrete', roughness: 0.7 },
};
const VINYL_MEAN: [number, number, number] = [196, 190, 178];

export const floorMaterialOf = (floor: FloorFinish, colour: string | undefined, wM: number, dM: number) => {
  const ph = FLOOR_PHOTO[floor];
  // plain tiles default to a light grey rather than the white of the photo
  if (ph) return photoMaterial(ph.photo, wM, dM, { colour: colour ?? (floor === 'tiles' ? '#d6d4ce' : undefined), roughness: ph.roughness, normal: floor === 'carpet' ? 0.4 : 0.7 });
  const t = vinylTexture().clone();
  t.needsUpdate = true;
  t.repeat.set(wM / 0.8, dM / 0.8);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0 });
  if (colour) {
    const c = new THREE.Color(colour), b = new THREE.Color().setRGB(...(VINYL_MEAN.map((v) => v / 255) as [number, number, number]), THREE.SRGBColorSpace);
    m.color.setRGB(c.r / b.r, c.g / b.g, c.b / b.b);
  }
  m.userData.own = true;
  return m;
};

export const floorMaterial = (layout: Layout, wM: number, dM: number) => floorMaterialOf(layout.floor, undefined, wM, dM);
