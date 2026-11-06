import * as THREE from 'three';
import { M, cyl, mesh, rbox, rod, std, tube } from './build';

// Procedural wheelchairs. Origin = centre of the chair footprint on the floor, front = +z.
// Dimensions follow typical rigid-frame manual chairs and mid-wheel-drive power chairs.

export interface ChairRig {
  root: THREE.Group;
  wheels: { obj: THREE.Object3D; radius: number }[];
  /** pelvis position of a seated user, chair-local, metres */
  seat: THREE.Vector3;
}

const spokedWheel = (R: number, frameMat: THREE.Material) => {
  const g = new THREE.Group();
  const tyre = mesh(new THREE.TorusGeometry(R - 0.016, 0.016, 14, 64), M.rubber);
  tyre.rotation.y = Math.PI / 2;
  g.add(tyre);
  const rim = mesh(new THREE.TorusGeometry(R - 0.036, 0.008, 8, 64), M.aluminium);
  rim.rotation.y = Math.PI / 2;
  g.add(rim);
  const hub = mesh(cyl(0.028, 0.028, 0.07, 20), M.aluminium);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  // crossed spokes
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const side = i % 2 ? 1 : -1;
    const off = side * 0.4;
    g.add(rod([side * 0.03, Math.sin(a + off) * 0.026, Math.cos(a + off) * 0.026], [side * 0.004, Math.sin(a) * (R - 0.04), Math.cos(a) * (R - 0.04)], 0.0014, M.steel, 4));
  }
  // push rim with standoffs (outside, +x)
  const pr = mesh(new THREE.TorusGeometry(R - 0.05, 0.0095, 10, 64), M.aluminium);
  pr.rotation.y = Math.PI / 2;
  pr.position.x = 0.04;
  g.add(pr);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(rod([0.004, Math.sin(a) * (R - 0.05), Math.cos(a) * (R - 0.05)], [0.04, Math.sin(a) * (R - 0.05), Math.cos(a) * (R - 0.05)], 0.004, M.aluminium, 6));
  }
  void frameMat;
  return g;
};

const caster = (r: number, frameMat: THREE.Material) => {
  const g = new THREE.Group(); // origin = top of caster stem
  g.add(mesh(cyl(0.017, 0.017, 0.05, 16), frameMat, [0, -0.025, 0]));
  const fork = new THREE.Group();
  fork.position.y = -0.05;
  for (const sx of [-1, 1]) fork.add(mesh(rbox(0.006, 0.08, 0.03, 0.002), frameMat, [sx * 0.022, -0.035, -0.03]));
  fork.add(mesh(rbox(0.05, 0.008, 0.03, 0.003), frameMat, [0, 0, -0.01]));
  const wheel = new THREE.Group();
  wheel.position.set(0, -0.075 + 0.0, -0.035);
  const w = mesh(cyl(r, r, 0.028, 28), M.rubber);
  w.rotation.z = Math.PI / 2;
  wheel.add(w);
  const hubc = mesh(cyl(r * 0.6, r * 0.6, 0.032, 20), std('#8a8f96', 0.4, 0.6));
  hubc.rotation.z = Math.PI / 2;
  wheel.add(hubc);
  fork.add(wheel);
  g.add(fork);
  return { g, wheel };
};

export const buildManualChair = (frameColor = '#2f4f7a'): ChairRig => {
  const root = new THREE.Group();
  const frame = std(frameColor, 0.32, 0.65);
  const R = 0.305; // 24" wheel
  const axleZ = -0.17;
  const wheels: ChairRig['wheels'] = [];
  for (const sx of [-1, 1]) {
    const w = spokedWheel(R, frame);
    w.position.set(sx * 0.282, R, axleZ);
    // camber 3°
    const holder = new THREE.Group();
    holder.add(w);
    holder.rotation.z = sx * THREE.MathUtils.degToRad(-3);
    if (sx < 0) w.scale.x = -1; // push rim on the outside
    root.add(holder);
    wheels.push({ obj: w, radius: R });

    // side frame: backrest post -> seat rail -> footrest hanger
    const x = sx * 0.21;
    root.add(tube([[x, 0.88, -0.255], [x, 0.62, -0.235], [x, 0.47, -0.2], [x, 0.455, 0.08], [x * 0.92, 0.4, 0.28], [x * 0.75, 0.16, 0.39]], 0.0125, frame, 0.3));
    // lower rail to caster
    root.add(rod([x, 0.32, axleZ], [x, 0.4, 0.28], 0.011, frame));
    // axle plate
    root.add(mesh(rbox(0.012, 0.11, 0.08, 0.004), M.blackMetal, [sx * 0.225, R, axleZ]));
    root.add(rod([x, 0.32, axleZ], [sx * 0.225, R, axleZ], 0.011, frame));
    root.add(rod([x, 0.47, -0.2], [sx * 0.225, R + 0.03, axleZ], 0.011, frame));
    // caster
    const c = caster(0.065, frame);
    c.g.position.set(x, 0.205, 0.29);
    root.add(c.g);
    root.add(rod([x, 0.205, 0.29], [x, 0.4, 0.28], 0.016, frame));
    wheels.push({ obj: c.wheel, radius: 0.065 });
    // clothing guard
    const guard = mesh(rbox(0.004, 0.13, 0.26, 0.002), std('#1d1f22', 0.3, 0.4), [sx * 0.236, 0.55, -0.12]);
    root.add(guard);
    // push handle
    root.add(mesh(cyl(0.015, 0.015, 0.09, 12), M.rubber, [x, 0.9, -0.27], [0.4, 0, 0]));
  }
  // cross members
  root.add(rod([-0.21, 0.455, 0.05], [0.21, 0.455, 0.05], 0.011, frame));
  root.add(rod([-0.21, 0.6, -0.235], [0.21, 0.6, -0.235], 0.009, frame));
  root.add(rod([-0.16, 0.16, 0.39], [0.16, 0.16, 0.39], 0.011, frame));
  // footplate
  root.add(mesh(rbox(0.34, 0.014, 0.15, 0.005), M.blackMetal, [0, 0.15, 0.4], [0.12, 0, 0]));
  // seat sling + cushion
  root.add(mesh(rbox(0.43, 0.012, 0.43, 0.005), M.blackFabric, [0, 0.462, -0.02]));
  const cushion = mesh(rbox(0.42, 0.07, 0.43, 0.025, 4), M.blackFabric, [0, 0.5, -0.02]);
  root.add(cushion);
  // backrest upholstery
  const back = mesh(rbox(0.41, 0.36, 0.035, 0.015, 3), M.blackFabric, [0, 0.72, -0.24], [-0.08, 0, 0]);
  root.add(back);

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, wheels, seat: new THREE.Vector3(0, 0.535 + 0.06, -0.11) };
};

export const buildPowerChair = (shellColor = '#7a2430'): ChairRig => {
  const root = new THREE.Group();
  const shell = std(shellColor, 0.3, 0.2);
  const wheels: ChairRig['wheels'] = [];
  // base
  root.add(mesh(rbox(0.5, 0.2, 0.78, 0.07, 4), M.blackMetal, [0, 0.22, 0]));
  root.add(mesh(rbox(0.52, 0.12, 0.6, 0.05, 4), shell, [0, 0.28, 0.02]));
  // drive wheels (mid)
  for (const sx of [-1, 1]) {
    const w = new THREE.Group();
    const t = mesh(new THREE.TorusGeometry(0.135, 0.04, 16, 48), M.rubber);
    t.rotation.y = Math.PI / 2;
    w.add(t);
    const hub = mesh(cyl(0.11, 0.11, 0.07, 32), std('#3a3d42', 0.35, 0.7));
    hub.rotation.z = Math.PI / 2;
    w.add(hub);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      w.add(mesh(rbox(0.074, 0.02, 0.06, 0.008), std('#555a61', 0.3, 0.8), [sx * 0.002, Math.sin(a) * 0.06, Math.cos(a) * 0.06], [a, 0, 0]));
    }
    w.position.set(sx * 0.275, 0.175, 0.0);
    root.add(w);
    wheels.push({ obj: w, radius: 0.175 });
    // front & rear casters
    for (const z of [-0.36, 0.36]) {
      const c = caster(0.075, M.blackMetal);
      c.g.position.set(sx * 0.2, 0.2, z + 0.03);
      root.add(c.g);
      wheels.push({ obj: c.wheel, radius: 0.075 });
    }
    // armrest
    root.add(mesh(rbox(0.07, 0.04, 0.34, 0.015), M.blackFabric, [sx * 0.275, 0.76, -0.02]));
    root.add(rod([sx * 0.275, 0.52, -0.12], [sx * 0.275, 0.74, -0.12], 0.012, M.blackMetal));
  }
  // seat post & seat
  root.add(mesh(cyl(0.05, 0.06, 0.12, 16), M.blackMetal, [0, 0.38, -0.03]));
  root.add(mesh(rbox(0.5, 0.05, 0.5, 0.01), M.blackMetal, [0, 0.45, -0.02]));
  root.add(mesh(rbox(0.48, 0.09, 0.48, 0.035, 4), M.blackFabric, [0, 0.515, -0.02]));
  // backrest + headrest
  root.add(mesh(rbox(0.46, 0.58, 0.08, 0.035, 4), M.blackFabric, [0, 0.86, -0.27], [-0.1, 0, 0]));
  root.add(mesh(rbox(0.26, 0.16, 0.07, 0.03, 4), M.blackFabric, [0, 1.27, -0.32], [-0.1, 0, 0]));
  root.add(rod([0, 1.12, -0.31], [0, 1.2, -0.32], 0.01, M.blackMetal));
  // joystick on the user's right (-x)
  root.add(mesh(rbox(0.08, 0.04, 0.12, 0.01), std('#202226', 0.4), [-0.275, 0.8, 0.12]));
  root.add(mesh(cyl(0.007, 0.007, 0.05, 10), M.blackMetal, [-0.275, 0.84, 0.13]));
  root.add(mesh(new THREE.SphereGeometry(0.016, 12, 10), M.rubber, [-0.275, 0.87, 0.13]));
  // legrest & footplate
  root.add(rod([0, 0.42, 0.2], [0, 0.17, 0.43], 0.018, M.blackMetal));
  root.add(mesh(rbox(0.36, 0.016, 0.17, 0.006), M.blackMetal, [0, 0.13, 0.46], [0.08, 0, 0]));

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, wheels, seat: new THREE.Vector3(0, 0.56 + 0.055, -0.11) };
};

