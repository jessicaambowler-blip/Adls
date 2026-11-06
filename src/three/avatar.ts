import * as THREE from 'three';
import { JOINTS, type Joint, type Pose } from '../activities/poses';
import type { PersonaSettings } from '../model/types';
import { fabric, lathe, limbGeometry, mesh, paint, rbox, std } from './build';

// Procedural, rigged human figure (placeholder until MetaHuman/glTF avatars are imported).
// Built at 1.75 m and scaled for other heights. Origin = pelvis (between hip joints).
// Faces +z, +x is the figure's LEFT.

export interface AvatarRig {
  root: THREE.Group;
  joints: Record<Joint, THREE.Object3D>;
  head: THREE.Object3D;
}

const skinMat = (c: string) => {
  const m = std(c, 0.55, 0);
  return m;
};

export const buildAvatar = (p: PersonaSettings, role: 'consumer' | 'support' = 'consumer'): AvatarRig => {
  const skin = skinMat(p.skin);
  const top = fabric(p.top);
  const bottoms = fabric(p.bottoms);
  const hair = std(p.hair, 0.8, 0);
  const shoe = std(role === 'support' ? '#ececec' : '#33302e', 0.6, 0);
  const sole = std('#e9e6e0', 0.8, 0);

  const root = new THREE.Group();
  root.name = 'avatar';
  const J = {} as Record<Joint, THREE.Object3D>;
  const joint = (name: Joint, parent: THREE.Object3D, pos: [number, number, number]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    parent.add(g);
    J[name] = g;
    return g;
  };

  // ---- pelvis & lower torso ----
  const pelvis = mesh(lathe([[0.001, -0.075], [0.11, -0.065], [0.155, -0.03], [0.168, 0.03], [0.162, 0.1], [0.15, 0.13]]), bottoms, [0, 0, -0.005]);
  pelvis.scale.set(1, 1, 0.68);
  root.add(pelvis);
  // waistband/belt line
  const belt = mesh(new THREE.TorusGeometry(0.152, 0.008, 6, 32), std('#2a2522', 0.5), [0, 0.12, -0.005], [Math.PI / 2, 0, 0]);
  belt.scale.set(1, 0.68, 1);
  root.add(belt);

  const spine = joint('spine', root, [0, 0.12, -0.01]);
  const lower = mesh(lathe([[0.15, -0.03], [0.148, 0.04], [0.142, 0.1], [0.15, 0.17], [0.162, 0.24]]), top, [0, 0, 0]);
  lower.scale.set(1, 1, 0.66);
  spine.add(lower);

  const chest = joint('chest', spine, [0, 0.22, 0]);
  const upper = mesh(lathe([[0.16, -0.03], [0.172, 0.06], [0.18, 0.14], [0.178, 0.2], [0.16, 0.245], [0.12, 0.27], [0.065, 0.285], [0.05, 0.29]]), top, [0, 0, 0.0]);
  upper.scale.set(1, 1, 0.64);
  chest.add(upper);
  // collar
  const collar = mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 24), top, [0, 0.282, 0.004], [Math.PI / 2 + 0.25, 0, 0]);
  chest.add(collar);

  // ---- neck & head ----
  const neck = joint('neck', chest, [0, 0.27, 0.0]);
  neck.add(mesh(limbGeometry(0.09, 0.05, 0.055, 0, 0.3), skin, [0, 0.09, 0.0]));
  const head = joint('head', neck, [0, 0.075, 0.012]);
  const skull = mesh(new THREE.SphereGeometry(0.1, 40, 32), skin, [0, 0.1, 0]);
  skull.scale.set(0.9, 1.1, 1.0);
  head.add(skull);
  const jaw = mesh(new THREE.SphereGeometry(0.075, 32, 24), skin, [0, 0.045, 0.03]);
  jaw.scale.set(0.95, 0.85, 1);
  head.add(jaw);
  const nose = mesh(new THREE.ConeGeometry(0.016, 0.04, 12), skin, [0, 0.095, 0.103], [Math.PI / 2 - 0.35, 0, 0]);
  head.add(nose);
  const noseTip = mesh(new THREE.SphereGeometry(0.014, 12, 10), skin, [0, 0.085, 0.112]);
  head.add(noseTip);
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(0.022, 16, 12), skin, [sx * 0.09, 0.1, -0.005]);
    ear.scale.set(0.45, 1.1, 0.8);
    head.add(ear);
    const eyeWhite = mesh(new THREE.SphereGeometry(0.012, 16, 12), std('#f4f1ea', 0.3), [sx * 0.034, 0.112, 0.085]);
    head.add(eyeWhite);
    const iris = mesh(new THREE.SphereGeometry(0.0065, 12, 10), std('#3a2a1e', 0.2), [sx * 0.034, 0.112, 0.0955]);
    head.add(iris);
    const brow = mesh(rbox(0.032, 0.006, 0.01, 0.003), hair, [sx * 0.035, 0.131, 0.09], [0.2, 0, sx * -0.08]);
    head.add(brow);
  }
  const mouth = mesh(rbox(0.035, 0.005, 0.006, 0.0025), std('#9a5d52', 0.5), [0, 0.055, 0.1]);
  head.add(mouth);
  // hair cap – covers top & back of the skull
  const hairCap = mesh(new THREE.SphereGeometry(0.106, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, [0, 0.108, -0.006], [-0.35, 0, 0]);
  hairCap.scale.set(0.93, 1.1, 1.03);
  head.add(hairCap);

  // ---- arms ----
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const sh = joint(`shoulder${side}`, chest, [sx * 0.185, 0.225, -0.01]);
    const delt = mesh(new THREE.SphereGeometry(0.058, 20, 16), top);
    delt.scale.set(1, 1, 0.95);
    sh.add(delt);
    // short sleeve over the upper arm, skin below
    sh.add(mesh(limbGeometry(0.15, 0.055, 0.05, 0.05), top));
    sh.add(mesh(limbGeometry(0.29, 0.044, 0.035, 0.14), skin));
    const el = joint(`elbow${side}`, sh, [0, -0.29, 0]);
    el.add(mesh(limbGeometry(0.25, 0.037, 0.026, 0.16), skin));
    const wr = joint(`wrist${side}`, el, [0, -0.255, 0]);
    // hand: palm + fingers + thumb
    const palm = mesh(rbox(0.07, 0.085, 0.028, 0.012), skin, [0, -0.045, 0.002]);
    wr.add(palm);
    const fingers = mesh(rbox(0.066, 0.075, 0.022, 0.01), skin, [0, -0.115, 0.006], [0.25, 0, 0]);
    wr.add(fingers);
    const thumb = mesh(limbGeometry(0.045, 0.012, 0.01, 0), skin, [-sx * -0.03, -0.03, 0.016], [0.6, 0, sx * 0.5]);
    wr.add(thumb);
  }

  // ---- legs ----
  for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
    const hip = joint(`hip${side}`, root, [sx * 0.09, 0, 0]);
    hip.add(mesh(limbGeometry(0.44, 0.088, 0.058, 0.08), bottoms));
    const knee = joint(`knee${side}`, hip, [0, -0.44, 0]);
    knee.add(mesh(limbGeometry(0.42, 0.058, 0.045, 0.1), bottoms));
    const cuff = mesh(new THREE.CylinderGeometry(0.047, 0.05, 0.03, 20), bottoms, [0, -0.39, 0]);
    knee.add(cuff);
    const ank = joint(`ankle${side}`, knee, [0, -0.42, 0]);
    ank.add(mesh(limbGeometry(0.05, 0.04, 0.04, 0), skin));
    const shoeM = mesh(rbox(0.1, 0.085, 0.27, 0.035), shoe, [0, -0.05, 0.065]);
    ank.add(shoeM);
    const soleM = mesh(rbox(0.102, 0.018, 0.272, 0.008), sole, [0, -0.088, 0.065]);
    ank.add(soleM);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  const s = p.heightCm / 175;
  root.scale.setScalar(s);
  return { root, joints: J, head: J.head };
};

const tmpE = new THREE.Euler();
export const applyPose = (rig: AvatarRig, pose: Required<Pose>) => {
  for (const j of JOINTS) {
    const v = pose[j];
    tmpE.set(THREE.MathUtils.degToRad(v[0]), THREE.MathUtils.degToRad(v[1]), THREE.MathUtils.degToRad(v[2]), 'XYZ');
    rig.joints[j].quaternion.setFromEuler(tmpE);
  }
};

export const SUPPORT_PERSONA: PersonaSettings = { name: 'Support worker', heightCm: 170, skin: '#e0b896', hair: '#6b4a2e', top: '#5b8c6e', bottoms: '#2d3a4a' };

export const paintAll = paint; // re-export for convenience
