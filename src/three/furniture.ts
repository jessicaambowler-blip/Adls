import * as THREE from 'three';
import type { Item } from '../model/types';
import { M, boxOn, cyl, fabric, lathe, mesh, paint, rbox, rod, std, tube } from './build';
import { leafTexture, rugTexture } from './textures';

// Procedural furniture & fixtures. Each builder returns a group whose origin is the centre of the
// item's footprint on the floor, front facing +z, sized from the item's mm dimensions.

type Builder = (w: number, d: number, h: number, it: Item) => THREE.Group;

const G = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  return g;
};

const handle = (x: number, y: number, z: number, len = 0.12, vertical = false) => {
  const g = new THREE.Group();
  g.add(rod([vertical ? 0 : -len / 2, vertical ? -len / 2 : 0, 0.025], [vertical ? 0 : len / 2, vertical ? len / 2 : 0, 0.025], 0.006, M.steel));
  for (const s of [-1, 1]) g.add(rod([vertical ? 0 : (s * len) / 2, vertical ? (s * len) / 2 : 0, 0], [vertical ? 0 : (s * len) / 2, vertical ? (s * len) / 2 : 0, 0.025], 0.005, M.steel));
  g.position.set(x, y, z);
  return g;
};

const lamp = (x: number, y: number, z: number) => {
  const g = new THREE.Group();
  g.add(mesh(lathe([[0.06, 0], [0.065, 0.02], [0.03, 0.05], [0.02, 0.22], [0.012, 0.3]]), M.ceramic));
  const shade = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.17, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffdca0', emissiveIntensity: 0.25 }), [0, 0.36, 0]);
  g.add(shade);
  g.position.set(x, y, z);
  return g;
};

const bed: Builder = (w, d, h, it) => {
  const adjustable = it.kind === 'bed-adjustable';
  const g = new THREE.Group();
  const mattressH = adjustable ? 0.16 : 0.24;
  const baseTop = h - mattressH;
  if (adjustable) {
    // metal frame on castors
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(mesh(cyl(0.03, 0.03, 0.06), M.rubber, [sx * (w / 2 - 0.08), 0.04, sz * (d / 2 - 0.1)], [0, 0, Math.PI / 2]));
      g.add(rod([sx * (w / 2 - 0.08), 0.08, sz * (d / 2 - 0.1)], [sx * (w / 2 - 0.08), baseTop - 0.05, sz * (d / 2 - 0.1)], 0.02, M.steel));
    }
    g.add(boxOn(w - 0.04, 0.06, d - 0.04, M.steel, 0, baseTop - 0.06, 0));
    // head & foot boards (laminate)
    g.add(boxOn(w, 0.55, 0.035, M.walnut, 0, baseTop - 0.08, -d / 2 + 0.018, 0.01));
    g.add(boxOn(w, 0.38, 0.035, M.walnut, 0, baseTop - 0.08, d / 2 - 0.018, 0.01));
    // side rails (half length, raised on the far side only)
    for (const sx of [-1, 1]) {
      const z0 = -d / 2 + 0.2, z1 = -d / 2 + 0.2 + d * 0.45;
      const y = h + (sx < 0 ? 0.28 : 0.02);
      g.add(rod([sx * (w / 2 + 0.01), y, z0], [sx * (w / 2 + 0.01), y, z1], 0.012, M.aluminium));
      g.add(rod([sx * (w / 2 + 0.01), y - 0.12, z0], [sx * (w / 2 + 0.01), y - 0.12, z1], 0.012, M.aluminium));
    }
    // hand control on a cable
    g.add(mesh(rbox(0.06, 0.15, 0.03, 0.012), std('#e6e6e6', 0.5), [w / 2 + 0.03, h - 0.1, -0.2]));
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.025, 0.02, 0.1), M.walnut, [sx * (w / 2 - 0.08), 0.05, sz * (d / 2 - 0.08)]));
    g.add(boxOn(w, baseTop - 0.1, d, fabric('#8d8579'), 0, 0.1, 0, 0.02));
    // upholstered headboard
    g.add(boxOn(w + 0.04, 1.1, 0.08, fabric('#9b9083'), 0, 0.05, -d / 2 - 0.02, 0.03));
  }
  // mattress
  g.add(mesh(rbox(w - 0.02, mattressH, d - 0.04, 0.05, 4), M.linen, [0, baseTop + mattressH / 2, 0.0]));
  // duvet covering the lower 70% of the bed, draped over the sides
  const duvetColor = adjustable ? '#a8c4d8' : '#c9b8a3';
  const duvetLen = d * 0.68;
  g.add(mesh(rbox(w + 0.04, 0.06, duvetLen, 0.03, 4), fabric(duvetColor), [0, h + 0.02, d / 2 - duvetLen / 2 - 0.0]));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.03, mattressH * 0.8, duvetLen, 0.012), fabric(duvetColor), [sx * (w / 2 + 0.01), h - mattressH * 0.35, d / 2 - duvetLen / 2]));
  // folded-back sheet line
  g.add(mesh(rbox(w + 0.05, 0.07, 0.18, 0.03, 4), M.linen, [0, h + 0.03, d / 2 - duvetLen]));
  // pillows
  const n = w > 1.2 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const px = n === 1 ? 0 : (i - 0.5) * (w / 2);
    const pil = mesh(rbox(Math.min(0.68, w / n - 0.08), 0.13, 0.42, 0.06, 4), M.linen, [px, h + 0.07, -d / 2 + 0.3], [0.15, 0, 0]);
    g.add(pil);
  }
  return g;
};

const bedsideTable: Builder = (w, d, h) =>
  G(
    boxOn(w, h - 0.02, d, M.oak, 0, 0, 0, 0.01),
    boxOn(w + 0.02, 0.025, d + 0.02, M.oak, 0, h - 0.025, 0, 0.006),
    boxOn(w - 0.04, h * 0.28, 0.01, M.whiteLaminate, 0, h * 0.62, d / 2, 0.003),
    handle(0, h * 0.76, d / 2 + 0.005, 0.1),
    lamp(-w * 0.18, h, -d * 0.1),
  );

const wardrobe: Builder = (w, d, h) => {
  const g = G(boxOn(w, h, d, M.whiteLaminate, 0, 0, 0, 0.005));
  const n = w > 1.3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const pw = w / n;
    const x = -w / 2 + pw * (i + 0.5);
    const door = boxOn(pw - 0.01, h - 0.08, 0.02, i === 1 ? M.mirror : M.oak, x, 0.04, d / 2 + (i % 2 ? 0.035 : 0.012), 0.004);
    g.add(door);
    g.add(handle(x + (i === 0 ? pw / 2 - 0.06 : -pw / 2 + 0.06), h * 0.5, d / 2 + 0.04, 0.4, true));
  }
  g.add(boxOn(w, 0.05, 0.05, M.aluminium, 0, h - 0.05, d / 2 + 0.03, 0));
  return g;
};

const drawers: Builder = (w, d, h) => {
  const g = G(boxOn(w, h, d, M.walnut, 0, 0.04, 0, 0.006));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.015, 0.012, 0.04), M.blackMetal, [sx * (w / 2 - 0.05), 0.02, sz * (d / 2 - 0.05)]));
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const dh = (h - 0.06) / rows;
    const y = 0.07 + r * dh;
    g.add(boxOn(w - 0.04, dh - 0.012, 0.012, M.oak, 0, y, d / 2 + 0.002, 0.003));
    g.add(handle(0, y + dh / 2, d / 2 + 0.008, Math.min(0.25, w * 0.3)));
  }
  g.add(lamp(w * 0.28, h + 0.04, 0));
  return g;
};

const armchair: Builder = (w, d, h) => {
  const f = fabric('#6f7f6b');
  return G(
    boxOn(w - 0.06, 0.3, d - 0.1, f, 0, 0.1, 0.02, 0.04),
    mesh(rbox(w - 0.3, 0.14, d - 0.25, 0.05, 4), f, [0, 0.47, 0.06]),
    mesh(rbox(w - 0.1, h - 0.4, 0.18, 0.06, 4), f, [0, 0.4 + (h - 0.4) / 2, -d / 2 + 0.12], [-0.12, 0, 0]),
    mesh(rbox(0.14, 0.28, d - 0.1, 0.05, 4), f, [-w / 2 + 0.08, 0.5, 0.02]),
    mesh(rbox(0.14, 0.28, d - 0.1, 0.05, 4), f, [w / 2 - 0.08, 0.5, 0.02]),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => mesh(cyl(0.02, 0.015, 0.1), M.walnut, [sx * (w / 2 - 0.08), 0.05, sz * (d / 2 - 0.1)]))),
  );
};

const desk: Builder = (w, d, h) => {
  const g = G(boxOn(w, 0.03, d, M.oak, 0, h - 0.03, 0, 0.005));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(0.04, h - 0.03, 0.04, 0.006), M.blackMetal, [sx * (w / 2 - 0.04), (h - 0.03) / 2, sz * (d / 2 - 0.04)]));
  // laptop
  g.add(boxOn(0.32, 0.012, 0.22, std('#9aa0a6', 0.3, 0.8), 0.1, h, 0.05, 0.004));
  const screen = boxOn(0.32, 0.21, 0.008, std('#2b2e33', 0.3, 0.5), 0.1, h + 0.012, -0.06, 0.003);
  screen.rotation.x = -0.25;
  g.add(screen);
  return g;
};

const toilet: Builder = (w, d) => {
  const g = new THREE.Group();
  // pedestal & bowl
  const ped = mesh(lathe([[0.13, 0], [0.12, 0.05], [0.1, 0.2], [0.13, 0.32], [0.17, 0.38], [0.18, 0.4]]), M.ceramic, [0, 0, 0]);
  ped.scale.set(w / 0.4, 1, 1.35);
  ped.position.z = -d / 2 + 0.43;
  g.add(ped);
  // seat (ring) and lid (raised)
  const seat = mesh(new THREE.TorusGeometry(0.15, 0.025, 12, 40), M.ceramic, [0, 0.42, -d / 2 + 0.44], [Math.PI / 2, 0, 0]);
  seat.scale.set(w / 0.4, 1.3, 0.5);
  g.add(seat);
  const lid = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 40), M.ceramic, [0, 0.6, -d / 2 + 0.24], [Math.PI / 2 - 0.15, 0, 0]);
  lid.scale.set(w / 0.4, 1, 1.3);
  g.add(lid);
  // cistern
  g.add(mesh(rbox(w * 0.95, 0.38, 0.17, 0.03, 4), M.ceramic, [0, 0.62, -d / 2 + 0.09]));
  g.add(mesh(rbox(w, 0.03, 0.19, 0.01, 2), M.ceramic, [0, 0.82, -d / 2 + 0.09]));
  g.add(mesh(cyl(0.025, 0.025, 0.012), M.chrome, [0, 0.84, -d / 2 + 0.09]));
  return g;
};

const basin: Builder = (w, d, h, it) => {
  const g = new THREE.Group();
  const top = h;
  const vanity = it.kind === 'vanity';
  if (vanity) {
    g.add(boxOn(w, top - 0.12, d - 0.02, M.whiteLaminate, 0, 0.1, -0.01, 0.006));
    g.add(boxOn(w - 0.02, 0.1, d - 0.08, std('#3c3c3c', 0.6), 0, 0, -0.04, 0));
    g.add(boxOn(w / 2 - 0.015, top - 0.15, 0.015, M.oak, -w / 4, 0.115, d / 2 - 0.01, 0.004));
    g.add(boxOn(w / 2 - 0.015, top - 0.15, 0.015, M.oak, w / 4, 0.115, d / 2 - 0.01, 0.004));
    g.add(boxOn(w + 0.01, 0.025, d, M.stone, 0, top - 0.025, 0, 0.004));
  }
  // basin bowl
  const bowl = mesh(lathe([[0.0, -0.13], [0.12, -0.12], [0.19, -0.07], [0.22, 0], [0.235, 0.01], [0.24, 0.015]]), M.ceramic);
  bowl.scale.set((w - 0.08) / 0.48, 1, (d - 0.06) / 0.48);
  bowl.position.set(0, top - 0.005, 0.02);
  g.add(bowl);
  if (!vanity) g.add(mesh(rbox(w, 0.06, 0.12, 0.02), M.ceramic, [0, top - 0.02, -d / 2 + 0.06]));
  // waste trap under wall basin
  if (!vanity) g.add(tube([[0, top - 0.12, 0.02], [0, top - 0.3, 0.0], [0, top - 0.33, -0.12], [0, top - 0.3, -d / 2]], 0.02, M.chrome));
  // mixer tap
  g.add(mesh(cyl(0.022, 0.025, 0.12), M.chrome, [0, top + 0.06, -d / 2 + 0.06]));
  g.add(rod([0, top + 0.11, -d / 2 + 0.06], [0, top + 0.1, -d / 2 + 0.16], 0.012, M.chrome));
  g.add(rod([0, top + 0.13, -d / 2 + 0.06], [0, top + 0.16, -d / 2 + 0.17], 0.007, M.chrome));
  // mirror on the wall above (tilted for wheelchair users)
  g.add(boxOn(Math.max(0.5, w), 0.8, 0.012, M.mirror, 0, top + 0.18, -d / 2 + 0.01, 0.004));
  return g;
};

const shower: Builder = (w, d) => {
  const g = new THREE.Group();
  // slightly darker tiled floor area falling to a linear drain
  g.add(boxOn(w, 0.004, d, std('#c7c5bf', 0.5), 0, 0, 0, 0));
  g.add(boxOn(0.07, 0.006, d - 0.1, M.steel, -w / 2 + 0.15, 0, 0, 0));
  // hand-held shower on a slide rail on the back wall (-z)
  g.add(rod([w * 0.2, 0.9, -d / 2 + 0.04], [w * 0.2, 1.9, -d / 2 + 0.04], 0.012, M.chrome));
  g.add(mesh(cyl(0.045, 0.03, 0.06), M.chrome, [w * 0.2, 1.75, -d / 2 + 0.11], [Math.PI / 2 + 0.4, 0, 0]));
  g.add(tube([[w * 0.2, 1.7, -d / 2 + 0.1], [w * 0.15, 1.1, -d / 2 + 0.2], [w * 0.22, 0.95, -d / 2 + 0.06]], 0.007, M.chrome));
  // mixer
  g.add(mesh(cyl(0.035, 0.035, 0.04), M.chrome, [w * 0.2, 1.0, -d / 2 + 0.03], [Math.PI / 2, 0, 0]));
  // fold-down shower seat on the side wall (-x)
  g.add(boxOn(0.04, 0.03, 0.45, M.steel, -w / 2 + 0.03, 0.45, 0, 0));
  g.add(boxOn(0.4, 0.03, 0.42, std('#e8e8e4', 0.5), -w / 2 + 0.24, 0.47, 0, 0.01));
  // curtain rail along the open (front, +z) side and curtain bunched near the wall
  g.add(rod([w / 2, 1.95, d / 2], [-w / 2, 1.95, d / 2], 0.012, M.chrome));
  const curtainPts: THREE.Vector2[] = [];
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= 20; i++) curtainPts.push(new THREE.Vector2((i / 20) * 0.45, Math.sin(i * 1.6) * 0.03));
  const curtain = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape([...curtainPts, ...curtainPts.slice().reverse().map((p) => new THREE.Vector2(p.x, p.y + 0.004))]), { depth: 1.75, bevelEnabled: false }),
    new THREE.MeshStandardMaterial({ color: '#dfe9ee', roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.88 }),
  );
  curtain.rotation.x = Math.PI / 2;
  curtain.position.set(w / 2 - 0.47, 1.94, d / 2);
  curtain.castShadow = true;
  g.add(curtain);
  return g;
};

const commode: Builder = (w, d, h) => {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    g.add(tube([[sx * (w / 2 - 0.05), 0.12, d / 2 - 0.08], [sx * (w / 2 - 0.05), 0.5, d / 2 - 0.12], [sx * (w / 2 - 0.05), 0.52, -d / 2 + 0.1], [sx * (w / 2 - 0.06), h, -d / 2 + 0.06]], 0.013, M.steel, 0.2));
    g.add(rod([sx * (w / 2 - 0.05), 0.12, -d / 2 + 0.08], [sx * (w / 2 - 0.05), 0.52, -d / 2 + 0.1], 0.013, M.steel));
    for (const z of [d / 2 - 0.08, -d / 2 + 0.08]) {
      const c = mesh(cyl(0.05, 0.05, 0.03, 20), std('#555', 0.6), [sx * (w / 2 - 0.05), 0.06, z], [0, 0, Math.PI / 2]);
      g.add(c);
    }
    g.add(mesh(rbox(0.06, 0.04, 0.3, 0.015), std('#30343a', 0.7), [sx * (w / 2 - 0.04), 0.74, -0.02]));
  }
  const seat = mesh(new THREE.TorusGeometry(0.15, 0.05, 12, 32), std('#30343a', 0.7), [0, 0.53, 0.02], [Math.PI / 2, 0, 0]);
  seat.scale.set(1.1, 1.25, 0.7);
  g.add(seat);
  g.add(mesh(rbox(w - 0.14, 0.32, 0.03, 0.012), std('#30343a', 0.7), [0, 0.85, -d / 2 + 0.07], [-0.1, 0, 0]));
  return g;
};

const grabRail: Builder = (w) => {
  const g = new THREE.Group();
  g.add(rod([-w / 2 + 0.03, 0, 0.0], [w / 2 - 0.03, 0, 0.0], 0.016, M.steel));
  for (const s of [-1, 1]) {
    g.add(rod([s * (w / 2 - 0.03), 0, 0], [s * (w / 2 - 0.03), 0, -0.06], 0.016, M.steel));
    g.add(mesh(cyl(0.035, 0.035, 0.01, 20), M.steel, [s * (w / 2 - 0.03), 0, -0.065], [Math.PI / 2, 0, 0]));
  }
  g.position.z = 0.02;
  return G(g);
};

const bath: Builder = (w, d, h) => {
  const g = new THREE.Group();
  const t = 0.07;
  g.add(boxOn(w, h, t, M.ceramic, 0, 0, d / 2 - t / 2, 0.01));
  g.add(boxOn(w, h, t, M.ceramic, 0, 0, -d / 2 + t / 2, 0.01));
  g.add(boxOn(t, h, d, M.ceramic, w / 2 - t / 2, 0, 0, 0.01));
  g.add(boxOn(t, h, d, M.ceramic, -w / 2 + t / 2, 0, 0, 0.01));
  g.add(boxOn(w - 0.1, 0.12, d - 0.1, M.ceramic, 0, 0, 0, 0.02));
  g.add(mesh(cyl(0.022, 0.022, 0.12), M.chrome, [-w / 2 + 0.04, h + 0.06, 0]));
  g.add(rod([-w / 2 + 0.04, h + 0.11, 0], [-w / 2 + 0.15, h + 0.1, 0], 0.012, M.chrome));
  return g;
};

const hoist: Builder = (w, d, h) => {
  const g = new THREE.Group();
  const mat = std('#d9dde2', 0.4, 0.3);
  const backZ = -d / 2 + 0.12;
  // splayed legs
  for (const sx of [-1, 1]) {
    g.add(rod([sx * 0.12, 0.09, backZ], [sx * (w / 2 - 0.04), 0.09, d / 2 - 0.05], 0.025, mat));
    for (const z of [backZ, d / 2 - 0.05]) g.add(mesh(cyl(0.04, 0.04, 0.03, 16), M.rubber, [sx * (z === backZ ? 0.12 : w / 2 - 0.04), 0.04, z], [0, 0, Math.PI / 2]));
  }
  g.add(boxOn(0.28, 0.12, 0.2, mat, 0, 0.05, backZ, 0.02));
  // mast, actuator & boom
  g.add(mesh(rbox(0.07, h - 0.1, 0.07, 0.01), mat, [0, 0.1 + (h - 0.1) / 2, backZ]));
  g.add(mesh(rbox(0.16, 0.22, 0.12, 0.02), std('#3b6fb6', 0.4, 0.1), [0, 0.7, backZ + 0.08]));
  g.add(rod([0, 0.75, backZ + 0.08], [0, h - 0.2, backZ + 0.45], 0.025, std('#3b6fb6', 0.4, 0.1)));
  g.add(rod([0, h - 0.02, backZ], [0, h - 0.1, d / 2 - 0.25], 0.035, mat));
  // spreader bar
  g.add(rod([0, h - 0.1, d / 2 - 0.25], [0, h - 0.3, d / 2 - 0.25], 0.012, mat));
  g.add(rod([-0.25, h - 0.3, d / 2 - 0.25], [0.25, h - 0.3, d / 2 - 0.25], 0.016, mat));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 16, Math.PI * 1.5), mat, [sx * 0.25, h - 0.33, d / 2 - 0.25]));
  // handle
  g.add(rod([-0.18, 1.05, backZ - 0.08], [0.18, 1.05, backZ - 0.08], 0.014, M.rubber));
  return g;
};

const kitchenBench: Builder = (w, d, h) => {
  const g = new THREE.Group();
  const kick = 0.12;
  g.add(boxOn(w, kick, d - 0.06, std('#3a3a3a', 0.7), 0, 0, -0.03, 0));
  g.add(boxOn(w, h - kick - 0.035, d - 0.02, M.whiteLaminate, 0, kick, -0.01, 0.003));
  const n = Math.max(1, Math.round(w / 0.6));
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + pw * (i + 0.5);
    g.add(boxOn(pw - 0.006, h - kick - 0.05, 0.018, std('#5d7a8c', 0.5), x, kick + 0.005, d / 2 - 0.01, 0.003));
    g.add(handle(x + pw / 2 - 0.05, h - 0.12, d / 2 + 0.002, 0.12, true));
  }
  g.add(boxOn(w + 0.02, 0.035, d + 0.02, M.stone, 0, h - 0.035, 0, 0.004));
  // sink & tap
  const sx = -w * 0.18;
  g.add(boxOn(0.5, 0.004, 0.38, M.steel, sx, h, 0.02, 0));
  g.add(boxOn(0.42, 0.002, 0.32, std('#888c90', 0.25, 0.9), sx, h + 0.003, 0.02, 0));
  g.add(mesh(cyl(0.022, 0.026, 0.3), M.chrome, [sx, h + 0.15, -d / 2 + 0.08]));
  g.add(tube([[sx, h + 0.3, -d / 2 + 0.08], [sx, h + 0.36, -d / 2 + 0.14], [sx, h + 0.3, -d / 2 + 0.24]], 0.012, M.chrome));
  // cooktop
  g.add(boxOn(0.6, 0.006, 0.5, std('#111214', 0.1, 0.3), w * 0.22, h, 0.0, 0.003));
  // upper cabinets
  g.add(boxOn(w, 0.7, 0.35, M.whiteLaminate, 0, 1.45, -d / 2 + 0.175, 0.004));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + pw * (i + 0.5);
    g.add(boxOn(pw - 0.006, 0.69, 0.018, std('#e9e4da', 0.5), x, 1.455, -d / 2 + 0.36, 0.003));
  }
  return g;
};

const fridge: Builder = (w, d, h) =>
  G(
    boxOn(w, h, d, std('#cfd3d6', 0.25, 0.7), 0, 0, 0, 0.02),
    boxOn(w - 0.01, 0.006, 0.01, std('#222', 0.5), 0, h * 0.62, d / 2, 0),
    handle(-w / 2 + 0.06, h * 0.78, d / 2 + 0.005, 0.4, true),
    handle(-w / 2 + 0.06, h * 0.45, d / 2 + 0.005, 0.4, true),
  );

const diningTable: Builder = (w, d, h) => {
  const g = G(boxOn(w, 0.035, d, M.oak, 0, h - 0.035, 0, 0.008));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.025, 0.02, h - 0.035), M.oak, [sx * (w / 2 - 0.07), (h - 0.035) / 2, sz * (d / 2 - 0.07)]));
  // two chairs on the far side only, leaving the near side for a wheelchair
  for (const cx of [-w / 4, w / 4]) {
    const c = new THREE.Group();
    c.add(boxOn(0.44, 0.03, 0.42, M.oak, 0, 0.45, 0, 0.006));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.add(mesh(cyl(0.015, 0.015, 0.45), M.oak, [sx * 0.19, 0.225, sz * 0.18]));
    c.add(boxOn(0.42, 0.4, 0.025, M.oak, 0, 0.48, -0.2, 0.006));
    c.position.set(cx, 0, -d / 2 - 0.12);
    g.add(c);
  }
  return g;
};

const sofa: Builder = (w, d, h) => {
  const f = fabric('#8a8f99');
  const g = G(
    boxOn(w - 0.04, 0.24, d - 0.08, f, 0, 0.08, 0.02, 0.04),
    mesh(rbox(w - 0.1, h - 0.38, 0.2, 0.06, 4), f, [0, 0.36 + (h - 0.38) / 2, -d / 2 + 0.13], [-0.1, 0, 0]),
    mesh(rbox(0.18, 0.32, d - 0.06, 0.06, 4), f, [-w / 2 + 0.09, 0.48, 0.0]),
    mesh(rbox(0.18, 0.32, d - 0.06, 0.06, 4), f, [w / 2 - 0.09, 0.48, 0.0]),
  );
  // three seat cushions
  const cw = (w - 0.36) / 3;
  for (let i = 0; i < 3; i++) g.add(mesh(rbox(cw - 0.01, 0.13, d - 0.3, 0.05, 4), f, [-w / 2 + 0.18 + cw * (i + 0.5), 0.39, 0.07]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.02, 0.015, 0.08), M.walnut, [sx * (w / 2 - 0.08), 0.04, sz * (d / 2 - 0.1)]));
  return g;
};

const diningChair: Builder = (w, d, h) => {
  const c = new THREE.Group();
  c.add(boxOn(w - 0.02, 0.03, d - 0.06, M.oak, 0, 0.43, 0.02, 0.006));
  c.add(mesh(rbox(w - 0.06, 0.03, d - 0.12, 0.012, 3), fabric('#c9b79c'), [0, 0.475, 0.03]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.add(mesh(cyl(0.015, 0.015, 0.43), M.oak, [sx * (w / 2 - 0.04), 0.215, sz * (d / 2 - 0.05)]));
  c.add(boxOn(w - 0.04, h - 0.5, 0.025, M.oak, 0, 0.47, -d / 2 + 0.04, 0.006));
  return c;
};

const tvUnit: Builder = (w, d, h) => {
  const g = G(boxOn(w, 0.45, d, M.walnut, 0, 0.05, 0, 0.01));
  for (const sx of [-1, 1]) g.add(mesh(cyl(0.015, 0.015, 0.05), M.blackMetal, [sx * (w / 2 - 0.06), 0.025, 0]));
  g.add(handle(-w / 4, 0.3, d / 2, 0.14));
  g.add(handle(w / 4, 0.3, d / 2, 0.14));
  // television on a stand
  const tvW = Math.min(1.25, w - 0.2), tvH = Math.min(tvW * 0.58, h - 0.55);
  g.add(boxOn(0.3, 0.02, 0.18, M.blackMetal, 0, 0.5, 0, 0.004));
  g.add(mesh(rbox(0.05, 0.07, 0.03, 0.005), M.blackMetal, [0, 0.555, -0.02]));
  g.add(boxOn(tvW, tvH, 0.04, std('#16181b', 0.25, 0.3), 0, 0.59, -0.02, 0.006));
  g.add(mesh(new THREE.PlaneGeometry(tvW - 0.03, tvH - 0.03), std('#1f2a36', 0.15, 0.1), [0, 0.59 + tvH / 2, 0.001]));
  return g;
};

const grabRailL: Builder = (w, _d, h) => {
  // horizontal leg along the wall, vertical leg rising from its right-hand end
  const g = new THREE.Group();
  const x0 = -w / 2 + 0.03, x1 = w / 2 - 0.03;
  g.add(rod([x0, 0, 0], [x1, 0, 0], 0.016, M.steel));
  g.add(rod([x1, 0, 0], [x1, Math.max(0.2, h), 0], 0.016, M.steel));
  for (const [x, y] of [[x0, 0], [x1, Math.max(0.2, h)]] as const) {
    g.add(rod([x, y, 0], [x, y, -0.06], 0.016, M.steel));
    g.add(mesh(cyl(0.035, 0.035, 0.01, 20), M.steel, [x, y, -0.065], [Math.PI / 2, 0, 0]));
  }
  g.position.z = 0.02;
  return G(g);
};

const concrete = () => paint('#c9c6bf', 0.85);

const ramp: Builder = (w, d, h, it) => {
  const r = it.ramp ?? { rise: h * 1000, gradient: 14, landing: 1200, rails: 'both' as const };
  const rise = r.rise / 1000, landing = Math.min(d, r.landing / 1000);
  const top = -d / 2 + landing; // where the slope meets the landing (the ramp rises towards -z)
  const shape = new THREE.Shape();
  shape.moveTo(d / 2, 0); shape.lineTo(top, rise); shape.lineTo(-d / 2, rise); shape.lineTo(-d / 2, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(w / 2, 0, 0);
  const g = G(mesh(geo, concrete()));
  // edge kerbs and handrails ~900 mm above the surface on the chosen sides (left = left going up)
  const surfaceAt = (z: number) => (z >= top ? rise * (d / 2 - z) / Math.max(0.001, d / 2 - top) : rise);
  const sides = r.rails === 'both' ? [-1, 1] : r.rails === 'left' ? [-1] : r.rails === 'right' ? [1] : [];
  for (const sx of sides) {
    const x = sx * (w / 2 - 0.03);
    const pts: [number, number, number][] = [[x, 0.9, d / 2 + 0.15], [x, 0.9 + surfaceAt(d / 2 - 0.01), d / 2 - 0.01], [x, 0.9 + rise, top], [x, 0.9 + rise, -d / 2 + 0.05]];
    for (let i = 0; i < pts.length - 1; i++) g.add(rod(pts[i], pts[i + 1], 0.02, M.steel));
    const n = Math.max(2, Math.ceil(d / 1.2));
    for (let i = 0; i <= n; i++) {
      const z = d / 2 - 0.05 - ((d - 0.1) * i) / n;
      const y0 = surfaceAt(z);
      g.add(rod([x, y0, z], [x, y0 + 0.9, z], 0.02, M.steel));
    }
  }
  for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.075, d), concrete(), [sx * (w / 2 - 0.025), 0.0375, 0]));
  return g;
};

const step: Builder = (w, d, h) => G(boxOn(w, h, d, concrete(), 0, 0, 0, 0.004));

const hallTable: Builder = (w, d, h) => {
  const g = G(boxOn(w, 0.03, d, M.walnut, 0, h - 0.03, 0, 0.005));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.015, 0.012, h - 0.03), M.blackMetal, [sx * (w / 2 - 0.04), (h - 0.03) / 2, sz * (d / 2 - 0.04)]));
  g.add(mesh(lathe([[0.04, 0], [0.07, 0.08], [0.05, 0.2], [0.03, 0.26], [0.035, 0.28]]), std('#2e5d6b', 0.25), [w * 0.25, h, 0]));
  return g;
};

const rug: Builder = (w, d) => {
  const m = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 });
  const g = G(mesh(rbox(w, 0.01, d, 0.004), m, [0, 0.005, 0]));
  g.traverse((o) => { o.castShadow = false; });
  return g;
};

const plant: Builder = (w, _d, h) => {
  const g = new THREE.Group();
  g.add(mesh(lathe([[w * 0.32, 0], [w * 0.4, 0.3], [w * 0.42, 0.32]]), std('#b86a4b', 0.8)));
  const leaf = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.7 });
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4;
    const r = 0.06 + (i % 3) * 0.05;
    const s = mesh(new THREE.IcosahedronGeometry(0.16 - (i % 3) * 0.02, 1), leaf, [Math.cos(a) * r, 0.4 + (i / 9) * (h - 0.55), Math.sin(a) * r]);
    s.scale.set(1, 0.8, 1);
    g.add(s);
  }
  g.add(rod([0, 0.3, 0], [0, h - 0.3, 0], 0.015, std('#5a4630', 0.8)));
  return g;
};

const turningSpace: Builder = (w) => {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(w / 2 - 0.025, w / 2, 96), new THREE.MeshBasicMaterial({ color: '#1f7a5a', transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - 0.025, 96), new THREE.MeshBasicMaterial({ color: '#2fb383', transparent: true, opacity: 0.15, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.005;
  g.add(ring, fill);
  return g;
};

const BUILDERS: Partial<Record<Item['kind'], Builder>> = {
  'bed-queen': bed, 'bed-single': bed, 'bed-adjustable': bed,
  'bedside-table': bedsideTable, wardrobe, drawers, armchair, sofa, 'dining-chair': diningChair, 'tv-unit': tvUnit, desk,
  toilet, basin, vanity: basin, shower, 'shower-commode': commode, 'grab-rail': grabRail, 'grab-rail-l': grabRailL, ramp, step, bath,
  'mobile-hoist': hoist, 'kitchen-bench': kitchenBench, fridge, 'dining-table': diningTable,
  'hall-table': hallTable, rug, plant, 'turning-space': turningSpace,
};

export const buildItem = (it: Item): THREE.Group => {
  const b = BUILDERS[it.kind];
  const w = it.w / 1000, d = it.d / 1000, h = it.h / 1000;
  const g = b ? b(w, d, h, it) : G(boxOn(w, h, d, paint(it.color ?? '#bbbbbb')));
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && it.kind !== 'rug' && it.kind !== 'turning-space') { o.castShadow = true; o.receiveShadow = true; }
  });
  return g;
};
