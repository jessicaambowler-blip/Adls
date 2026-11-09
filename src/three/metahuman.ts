import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BONES, fetchBinary, type PersonSpec } from '../originals/originals';

// MetaHumans from the original VisADLs project: loading (body, clothes and face sharing one
// skeleton) and helpers shared by every scene that shows them.

// The exported FBX files name texture images that were not exported; answer those requests with a
// blank image instead of letting the browser try to load them.
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const noTextures = new THREE.LoadingManager();
noTextures.setURLModifier((url) => (/^(data|blob):/.test(url) ? url : BLANK));

const fbxCache = new Map<string, Promise<THREE.Group>>();
export const loadFbx = (url: string) => {
  let p = fbxCache.get(url);
  if (!p) {
    p = fetchBinary(url).then((buf) => new FBXLoader(noTextures).parse(buf, ''));
    fbxCache.set(url, p);
  }
  // SkeletonUtils.clone keeps skinned meshes bound to their own (cloned) bones
  return p.then((g) => SkeletonUtils.clone(g) as THREE.Group);
};

/** Unreal transform [x,y,z,qx,qy,qz,qw] -> object transform in FBX space */
export const setUE = (o: THREE.Object3D, s: number[], scale = 1) => {
  o.position.set(s[0], -s[1], s[2]);
  o.quaternion.set(s[3], -s[4], s[5], -s[6]).normalize();
  o.scale.setScalar(scale);
};

export const mat = (color: string, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
export const SKIN = '#b98a6e';
const clothColour = (file: string) =>
  /top_shirt/i.test(file) ? '#7f9c8a' : /top/i.test(file) ? '#5d84ad' : /slacks/i.test(file) ? '#3e4553' : /btm/i.test(file) ? '#5b5e4c'
    : /runningshoes/i.test(file) ? '#e4e4e0' : /shs/i.test(file) ? '#2a2a2a' : '#888';

export interface PersonRig {
  group: THREE.Group;
  bones: Record<string, THREE.Bone>;
  boneList: (THREE.Bone | undefined)[];
  head?: THREE.Object3D;
}


/**
 * Bones of a clothing/face mesh mapped onto the body's skeleton. Extra bones the body doesn't have
 * (facial bones, cloth bones) are moved under the matching body bone so they follow it.
 */
const shareBones = (m: THREE.SkinnedMesh, bones: Record<string, THREE.Bone>) =>
  m.skeleton.bones.map((b) => {
    if (bones[b.name]) return bones[b.name];
    const pn = b.parent?.name;
    if (pn && bones[pn] && b.parent !== bones[pn]) bones[pn].add(b);
    return b;
  });

// A simple painted eye (sclera, iris, pupil) used until the original eye textures are exported.
// MetaHuman eyeballs are UV-mapped from the front with the iris centred in UV space.
let eyeTexture: THREE.Texture | null = null;
const getEyeTexture = () => {
  if (eyeTexture) return eyeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f1ede4';
  g.fillRect(0, 0, 256, 256);
  const iris = g.createRadialGradient(128, 128, 8, 128, 128, 40);
  iris.addColorStop(0, '#5a4128');
  iris.addColorStop(0.75, '#6e5233');
  iris.addColorStop(1, '#2c2015');
  g.fillStyle = iris;
  g.beginPath(); g.arc(128, 128, 40, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0d0d0d';
  g.beginPath(); g.arc(128, 128, 16, 0, Math.PI * 2); g.fill();
  eyeTexture = new THREE.CanvasTexture(c);
  eyeTexture.colorSpace = THREE.SRGBColorSpace;
  return eyeTexture;
};

/**
 * Materials for a MetaHuman face mesh. Unreal's FBX export numbers the face's parts by section, in
 * the MetaHuman order head, teeth, left eye, right eye, eye shell, eyelashes, tear line – not by the
 * material list – so the parts are recognised by that order when the mesh has those seven parts.
 */
const faceMaterials = (m: THREE.SkinnedMesh, skin = SKIN) => {
  const groups = m.geometry.groups;
  const names = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name || '');
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const byPart = [
    mat(skin, 0.55),
    mat('#ece6da', 0.35),
    new THREE.MeshStandardMaterial({ map: getEyeTexture(), roughness: 0.15 }),
    new THREE.MeshStandardMaterial({ map: getEyeTexture(), roughness: 0.15 }),
    hidden,
    mat('#2a1e16', 0.9),
    hidden,
  ];
  if (groups.length === 7 && names.some((n) => /teeth/i.test(n))) {
    groups.forEach((g, i) => (g.materialIndex = i));
    return byPart;
  }
  return names.map((n) => {
    if (/occlusion|lacrimal|blend|shell|cartilage/i.test(n)) return hidden;
    if (/lash/i.test(n)) return mat('#2a1e16', 0.9);
    if (/eye/i.test(n)) return new THREE.MeshStandardMaterial({ map: getEyeTexture(), roughness: 0.15 });
    if (/teeth/i.test(n)) return mat('#ece6da', 0.35);
    return mat(skin, 0.55);
  });
};

/** A MetaHuman: body, clothes and face sharing one skeleton. */
export const buildPerson = async (spec: PersonSpec, base: string, root: THREE.Group): Promise<PersonRig> => {
  const sc = { person: spec };
  const person = new THREE.Group();
  root.add(person);

  // body
  const body = await loadFbx(base + sc.person.body);
  let bodyMesh: THREE.SkinnedMesh | undefined;
  body.traverse((x) => { if ((x as THREE.SkinnedMesh).isSkinnedMesh) bodyMesh = x as THREE.SkinnedMesh; });
  if (!bodyMesh) throw new Error('no body mesh');
  bodyMesh.material = mat(spec.skin ?? SKIN, 0.55);
  person.add(body);
  const bones: Record<string, THREE.Bone> = {};
  bodyMesh.skeleton.bones.forEach((b) => (bones[b.name] = b));

  // clothes share the body's skeleton
  for (const f of sc.person.clothes) {
    const g = await loadFbx(base + f);
    g.traverse((x) => {
      const m = x as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.bind(new THREE.Skeleton(shareBones(m, bones), m.skeleton.boneInverses), m.bindMatrix);
      m.material = mat(clothColour(f), 0.85);
      person.add(m);
    });
  }
  // face: share neck/head; facial bones ride along under the body's head
  const face = await loadFbx(base + sc.person.face);
  const faceMeshes: THREE.SkinnedMesh[] = [];
  face.traverse((x) => { if ((x as THREE.SkinnedMesh).isSkinnedMesh) faceMeshes.push(x as THREE.SkinnedMesh); });
  for (const m of faceMeshes) {
    m.bind(new THREE.Skeleton(shareBones(m, bones), m.skeleton.boneInverses), m.bindMatrix);
    m.material = faceMaterials(m, spec.skin);
    person.add(m);
  }
  // A camera anchor on the head whose +z is where the person faces and +y is up. Built in the rest
  // pose (actor at identity), where the MetaHuman faces +z in the app's 3D space.
  let anchor: THREE.Object3D | undefined;
  if (bones.head) {
    const wrapper = new THREE.Group();
    wrapper.rotation.x = -Math.PI / 2;
    wrapper.scale.setScalar(0.01);
    wrapper.add(root);
    wrapper.updateMatrixWorld(true);
    const headWorld = bones.head.matrixWorld.clone();
    const target = new THREE.Matrix4().makeTranslation(new THREE.Vector3().setFromMatrixPosition(headWorld));
    const local = headWorld.clone().invert().multiply(target);
    anchor = new THREE.Object3D();
    local.decompose(anchor.position, anchor.quaternion, anchor.scale);
    bones.head.add(anchor);
    wrapper.remove(root);
  }
  body.traverse((x) => { x.frustumCulled = false; });
  person.traverse((x) => { x.frustumCulled = false; if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.receiveShadow = true; } });
  return { group: person, bones, boneList: BONES.map((b) => bones[b]), head: anchor };
};


// ------------------------------------------------------------------ driving a MetaHuman with app poses
//
// The app's movement library (poses.ts) poses a simple figure: 16 joints, Euler angles in degrees,
// figure facing +z, +x its left, every joint's rest orientation aligned with the figure. A MetaHuman's
// rest pose is different (A-pose arms, bones with their own axes), so each mapped bone gets
//   world = figureJointWorld · correction · metaHumanRestWorld
// where `correction` turns the MetaHuman's rest limb to point the way the figure's rest limb points
// (arms and legs straight down). Bones without a figure joint (clavicles, twists, fingers, toes)
// keep their rest pose relative to their parent. All in "character space": the MetaHuman at rest
// under a group rotated -90° about X and scaled 0.01, i.e. the app's 3D axes.

import { JOINTS, type Joint, type Pose } from '../activities/poses';

export interface Retarget {
  idx: Record<string, number>;
  bones: (THREE.Bone | undefined)[];
  parent: number[];
  restLocal: THREE.Quaternion[];
  restWorld: THREE.Quaternion[];
  restPos: THREE.Vector3[];
  corr: (THREE.Quaternion | undefined)[];
  /** world rotation of the root bone's parent object (character space) */
  base: THREE.Quaternion;
  /** rest position of the point between the hip joints (character space, metres) */
  hipMid: THREE.Vector3;
}

export const CONV = new THREE.Matrix4().compose(new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(0.01, 0.01, 0.01));

/** Measure a freshly built (un-animated) MetaHuman. */
export const makeRetarget = (rig: PersonRig): Retarget => {
  const g = rig.group;
  const oldParent = g.parent;
  const saved = g.matrix.clone();
  const conv = new THREE.Group();
  CONV.decompose(conv.position, conv.quaternion, conv.scale);
  conv.add(g);
  g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.setScalar(1);
  conv.updateMatrixWorld(true);
  const idx: Record<string, number> = {};
  BONES.forEach((b, i) => (idx[b] = i));
  const bones = BONES.map((b) => rig.bones[b]);
  const parent = bones.map((b) => {
    let p = b?.parent;
    while (p && !(p.name in idx)) p = p.parent; // nearest animated ancestor
    return p ? idx[p.name] : -1;
  });
  const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const restWorld = bones.map((b) => (b ? wq(b) : new THREE.Quaternion()));
  const restPos = bones.map((b) => (b ? wp(b) : new THREE.Vector3()));
  const restLocal = bones.map((b, i) => (b ? (parent[i] >= 0 ? restWorld[parent[i]].clone().invert().multiply(restWorld[i]) : b.quaternion.clone()) : new THREE.Quaternion()));
  const root = bones[0];
  const base = root?.parent ? wq(root.parent) : new THREE.Quaternion();
  if (root) restLocal[0] = base.clone().invert().multiply(restWorld[0]);
  const down = new THREE.Vector3(0, -1, 0);
  const corr: (THREE.Quaternion | undefined)[] = bones.map(() => undefined);
  const align = (a: string, b: string) => {
    const i = idx[a], j = idx[b];
    if (!bones[i] || !bones[j]) return undefined;
    const dir = restPos[j].clone().sub(restPos[i]).normalize();
    return (corr[i] = new THREE.Quaternion().setFromUnitVectors(dir, down));
  };
  for (const s of ['l', 'r']) {
    align(`upperarm_${s}`, `lowerarm_${s}`);
    const fore = align(`lowerarm_${s}`, `hand_${s}`);
    if (fore) corr[idx[`hand_${s}`]] = fore;
    align(`thigh_${s}`, `calf_${s}`);
    const shin = align(`calf_${s}`, `foot_${s}`);
    if (shin) corr[idx[`foot_${s}`]] = shin;
  }
  const hipMid = restPos[idx.thigh_l].clone().add(restPos[idx.thigh_r]).multiplyScalar(0.5);
  conv.remove(g);
  saved.decompose(g.position, g.quaternion, g.scale);
  if (oldParent) oldParent.add(g);
  return { idx, bones, parent, restLocal, restWorld, restPos, corr, base, hipMid };
};

const E = new THREE.Euler();
const jointQ = (v: [number, number, number]) => new THREE.Quaternion().setFromEuler(E.set(THREE.MathUtils.degToRad(v[0]), THREE.MathUtils.degToRad(v[1]), THREE.MathUtils.degToRad(v[2]), 'XYZ'));
const part = (q: THREE.Quaternion, f: number) => new THREE.Quaternion().slerp(q, f);

/** Local bone rotations (BONES order) that put the MetaHuman in an app pose. */
export const poseLocals = (rt: Retarget, pose: Required<Pose>, out: THREE.Quaternion[]) => {
  const L = {} as Record<Joint, THREE.Quaternion>;
  for (const j of JOINTS) L[j] = jointQ(pose[j]);
  const spine = L.spine.clone();
  const chest = spine.clone().multiply(L.chest);
  const neck = chest.clone().multiply(L.neck);
  const head = neck.clone().multiply(L.head);
  const A: Record<string, THREE.Quaternion> = {
    spine_01: part(spine, 1 / 3), spine_02: part(spine, 2 / 3), spine_03: spine,
    spine_04: spine.clone().multiply(part(L.chest, 0.5)), spine_05: chest,
    neck_01: chest.clone().multiply(part(L.neck, 0.5)), neck_02: neck, head,
  };
  for (const [s, S] of [['l', 'L'], ['r', 'R']] as const) {
    const sh = chest.clone().multiply(L[`shoulder${S}`]);
    const el = sh.clone().multiply(L[`elbow${S}`]);
    const wr = el.clone().multiply(L[`wrist${S}`]);
    const hip = L[`hip${S}`].clone();
    const knee = hip.clone().multiply(L[`knee${S}`]);
    const ank = knee.clone().multiply(L[`ankle${S}`]);
    Object.assign(A, { [`upperarm_${s}`]: sh, [`lowerarm_${s}`]: el, [`hand_${s}`]: wr, [`thigh_${s}`]: hip, [`calf_${s}`]: knee, [`foot_${s}`]: ank });
  }
  const W: THREE.Quaternion[] = [];
  const n = BONES.length;
  for (let i = 0; i < n; i++) {
    const p = rt.parent[i];
    const pw = p >= 0 ? W[p] : rt.base;
    let w: THREE.Quaternion;
    const a = A[BONES[i]];
    if (i <= 1) w = rt.restWorld[i].clone(); // root & pelvis: the body's placement is done outside
    else if (a) w = a.clone().multiply(rt.corr[i] ?? new THREE.Quaternion()).multiply(rt.restWorld[i]);
    else w = pw.clone().multiply(rt.restLocal[i]);
    W[i] = w;
    (out[i] ??= new THREE.Quaternion()).copy(pw.clone().invert().multiply(w));
  }
  return out;
};
