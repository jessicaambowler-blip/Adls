import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BuiltActivity } from '../activities/activities';
import { BONES, fetchBinary, getOriginal, sampleTrack, type AnimData, type LoadedOriginal, type PersonSpec } from '../originals/originals';
import { useStore } from '../model/store';
import { buildPowerChair } from './wheelchair';

// Plays an original VisADLs recording: the real MetaHuman body/face/clothes driven by the recorded
// motion, the original bed and hoist bar, and the app's powered wheelchair following the original
// wheelchair's path. See originals.ts for the coordinate conventions.

const fbxCache = new Map<string, Promise<THREE.Group>>();
const loadFbx = (url: string) => {
  let p = fbxCache.get(url);
  if (!p) {
    p = fetchBinary(url).then((buf) => new FBXLoader().parse(buf, ''));
    fbxCache.set(url, p);
  }
  // SkeletonUtils.clone keeps skinned meshes bound to their own (cloned) bones
  return p.then((g) => SkeletonUtils.clone(g) as THREE.Group);
};

/** Unreal transform [x,y,z,qx,qy,qz,qw] -> object transform in FBX space */
const setUE = (o: THREE.Object3D, s: number[], scale = 1) => {
  o.position.set(s[0], -s[1], s[2]);
  o.quaternion.set(s[3], -s[4], s[5], -s[6]).normalize();
  o.scale.setScalar(scale);
};

const mat = (color: string, roughness = 0.7, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const SKIN = '#b98a6e';
const clothColour = (file: string) =>
  /top_shirt/i.test(file) ? '#7f9c8a' : /top/i.test(file) ? '#5d84ad' : /slacks/i.test(file) ? '#3e4553' : /btm/i.test(file) ? '#5b5e4c'
    : /runningshoes/i.test(file) ? '#e4e4e0' : /shs/i.test(file) ? '#2a2a2a' : '#888';
const bedColour = (file: string) =>
  /mattress/i.test(file) ? mat('#f1eee7', 0.9) : /pillow/i.test(file) ? mat('#fbfbf8', 0.95) : /blanket_base/i.test(file) ? mat('#9b7b5b', 0.6) : /leg/i.test(file) ? mat('#6b5440', 0.5) : mat('#8a6a4a', 0.55);

interface PersonRig {
  group: THREE.Group;
  bones: Record<string, THREE.Bone>;
  boneList: (THREE.Bone | undefined)[];
  head?: THREE.Object3D;
}

interface Rig {
  root: THREE.Group; // FBX space container
  person: PersonRig;
  helpers: PersonRig[];
  props: { obj: THREE.Object3D; idx: number }[];
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

/** A MetaHuman: body, clothes and face sharing one skeleton. */
const buildPerson = async (spec: PersonSpec, base: string, root: THREE.Group): Promise<PersonRig> => {
  const sc = { person: spec };
  const person = new THREE.Group();
  root.add(person);

  // body
  const body = await loadFbx(base + sc.person.body);
  let bodyMesh: THREE.SkinnedMesh | undefined;
  body.traverse((x) => { if ((x as THREE.SkinnedMesh).isSkinnedMesh) bodyMesh = x as THREE.SkinnedMesh; });
  if (!bodyMesh) throw new Error('no body mesh');
  bodyMesh.material = mat(SKIN, 0.6);
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
    const ms = Array.isArray(m.material) ? m.material : [m.material];
    const out = ms.map((mt) => {
      const n = mt.name || '';
      if (/occlusion|blend|shell|cartilage|lash/i.test(n)) return new THREE.MeshBasicMaterial({ visible: false });
      if (/eye/i.test(n)) return mat('#f2efe8', 0.3);
      if (/teeth/i.test(n)) return mat('#eeeae2', 0.4);
      if (/brow/i.test(n)) return mat('#3b2a20', 0.9);
      return mat(SKIN, 0.6);
    });
    m.material = out.length === 1 ? out[0] : out;
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

const buildRig = async (o: LoadedOriginal): Promise<Rig> => {
  const sc = o.scene;
  const base = o.rec.folder;
  const root = new THREE.Group();
  const person = await buildPerson(sc.person, base, root);
  const helpers: PersonRig[] = [];
  for (const h of sc.helpers ?? []) helpers.push(await buildPerson(h, base, root));

  // bed (static, Unreal world transforms)
  for (const part of sc.bed) {
    const g = await loadFbx(base + part.file);
    const holder = new THREE.Group();
    setUE(holder, part.world, part.world[7] ?? 1);
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) { (x as THREE.Mesh).material = bedColour(part.file); x.castShadow = true; x.receiveShadow = true; } });
    holder.add(g);
    root.add(holder);
  }
  // moving props with their own model (hoist bar)
  const props: Rig['props'] = [];
  for (const [i, p] of sc.props.entries()) {
    if (!p.file) continue;
    const g = await loadFbx(base + p.file);
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) { (x as THREE.Mesh).material = mat('#d7dbe0', 0.35, 0.6); x.castShadow = true; } });
    const holder = new THREE.Group();
    holder.add(g);
    root.add(holder);
    props.push({ obj: holder, idx: i });
  }
  return { root, person, helpers, props };
};

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

const posePerson = (p: PersonRig, spec: PersonSpec, anim: AnimData, t: number) => {
  setUE(p.group, sampleTrack(spec.track, t));
  const f = Math.max(0, Math.min(anim.frames - 1, t * spec.animFps));
  const i0 = Math.floor(f), i1 = Math.min(anim.frames - 1, i0 + 1), a = f - i0;
  const nb = BONES.length;
  for (let b = 0; b < nb; b++) {
    const bone = p.boneList[b];
    if (!bone) continue;
    const k0 = (i0 * nb + b) * 4, k1 = (i1 * nb + b) * 4;
    qa.set(anim.quats[k0], -anim.quats[k0 + 1], anim.quats[k0 + 2], -anim.quats[k0 + 3]);
    qb.set(anim.quats[k1], -anim.quats[k1 + 1], anim.quats[k1 + 2], -anim.quats[k1 + 3]);
    bone.quaternion.slerpQuaternions(qa, qb, a).normalize();
  }
  for (const [k, name] of ['root', 'pelvis'].entries()) {
    const bone = p.bones[name];
    if (!bone) continue;
    const p0 = i0 * 6 + k * 3, p1 = i1 * 6 + k * 3;
    bone.position.set(
      anim.trans[p0] + (anim.trans[p1] - anim.trans[p0]) * a,
      -(anim.trans[p0 + 1] + (anim.trans[p1 + 1] - anim.trans[p0 + 1]) * a),
      anim.trans[p0 + 2] + (anim.trans[p1 + 2] - anim.trans[p0 + 2]) * a,
    );
  }
};

export const OriginalActors = ({ built, live }: { built: BuiltActivity; live: { person?: { head: THREE.Object3D }; chair?: THREE.Object3D } }) => {
  const originalId = useStore((s) => s.project.activity.originalId);
  const assetVersion = useStore((s) => s.assetVersion);
  const o = getOriginal(originalId);
  const [rig, setRig] = useState<Rig | null>(null);

  const chair = useMemo(() => buildPowerChair('#3a4250'), []);

  useEffect(() => {
    let cancelled = false;
    setRig(null);
    if (!o) return;
    buildRig(o).then((r) => { if (!cancelled) setRig(r); }).catch((e) => console.error('original recording', e));
    return () => { cancelled = true; };
  }, [o, assetVersion]);

  useEffect(() => {
    if (rig?.person.head) live.person = { head: rig.person.head };
    live.chair = chair.root;
  }, [rig, chair, live]);

  useFrame(() => {
    if (!o || !rig) return;
    const t = useStore.getState().time;
    const sc = o.scene;
    // people: Body placement + recorded bones
    posePerson(rig.person, sc.person, o, t);
    rig.helpers.forEach((h, i) => { const a = o.helpers[i]; if (a && sc.helpers?.[i]) posePerson(h, sc.helpers[i], a, t); });
    for (const p of rig.props) {
      const pr = sc.props[p.idx];
      setUE(p.obj, sampleTrack(pr.track, t), pr.scale ?? 1);
    }
    // the app's powered wheelchair follows the original wheelchair's path
    const c = built.chair(t);
    chair.root.position.set(c.x / 1000, 0, c.y / 1000);
    chair.root.rotation.y = THREE.MathUtils.degToRad(-c.heading);
    chair.root.scale.setScalar(1.18); // the original chair's seat is higher than the app's model
    for (const w of chair.wheels) w.obj.rotation.x = c.wheelTurn / 1000 / w.radius;
  });

  if (!o) return null;
  const off = o.scene.offsetCm;
  return (
    <>
      <primitive object={chair.root} />
      {rig && (
        <group position={[off[0] / 100, 0, off[1] / 100]}>
          <group rotation-x={-Math.PI / 2} scale={0.01}>
            <primitive object={rig.root} />
          </group>
        </group>
      )}
    </>
  );
};
