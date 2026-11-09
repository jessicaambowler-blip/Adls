import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { P2_ID, type Anchor, type BodyState, type BuiltActivity, type Mix, type Src } from '../activities/activities';
import { BONES, getOriginal, sampleTrack, type AnimData, type LoadedOriginal, type PersonSpec } from '../originals/originals';
import { useStore } from '../model/store';
import type { ActivitySettings } from '../model/types';
import { CONV, buildPerson, loadFbx, makeRetarget, mat, poseLocals, type PersonRig, type Retarget } from './metahuman';
import { buildManualChair, buildPowerChair } from './wheelchair';

// Persona 2 from the original VisADLs project doing any activity in any layout. Each body (Persona 2,
// the carer, the hoist bar) is, at every moment, either taken from the recording – re-anchored from
// where it happened onto the chair or bed in this layout – or posed by the app's movement library,
// with smooth blends between the two (see BuiltActivity.mh).

interface Body {
  rig: PersonRig;
  rt: Retarget;
  /** app-space container whose matrix places the MetaHuman (its group stays at identity) */
  root: THREE.Group;
  restRoot: THREE.Vector3;
  restPelvis: THREE.Vector3;
}

interface Cast { person: Body; carer?: Body; hoist?: THREE.Group }

const makeBody = async (spec: PersonSpec, base: string): Promise<Body> => {
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  const rig = await buildPerson(spec, base, root);
  const rt = makeRetarget(rig);
  return { rig, rt, root, restRoot: rig.bones.root.position.clone(), restPelvis: rig.bones.pelvis.position.clone() };
};

const buildCast = async (o: LoadedOriginal, withCarer: boolean): Promise<Cast> => {
  const base = o.rec.folder;
  const person = await makeBody(o.scene.person, base);
  const carer = withCarer && o.scene.helpers?.[0] ? await makeBody(o.scene.helpers[0], base) : undefined;
  let hoist: THREE.Group | undefined;
  const hp = o.scene.props.find((p) => p.file);
  if (hp?.file) {
    const g = await loadFbx(base + hp.file);
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) { (x as THREE.Mesh).material = mat('#d7dbe0', 0.35, 0.6); x.castShadow = true; } });
    hoist = new THREE.Group();
    hoist.matrixAutoUpdate = false;
    hoist.add(g);
  }
  return { person, carer, hoist };
};

// ------------------------------------------------------------------ matrices

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const ry = (deg: number) => new THREE.Matrix4().makeRotationAxis(Y, THREE.MathUtils.degToRad(deg));
const tr = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Recording plan space -> this layout (app 3D, metres). */
const anchorMatrix = (a: Anchor) => {
  const m = tr(a.to.x / 1000, a.lift / 1000, a.to.y / 1000).multiply(ry(-a.to.h));
  if (a.mirror) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  return m.multiply(ry(a.from.h)).multiply(tr(-a.from.x / 1000, 0, -a.from.y / 1000));
};

/** Unreal [x,y,z,qx,qy,qz,qw] -> FBX-space matrix */
const ueMatrix = (s: number[], scale = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(s[0], -s[1], s[2]), new THREE.Quaternion(s[3], -s[4], s[5], -s[6]).normalize(), new THREE.Vector3(scale, scale, scale));

/** Where a recording's FBX-space content sits in the app, before re-anchoring. */
const recordingSpace = (o: LoadedOriginal) => tr(o.scene.offsetCm[0] / 100, -(o.scene.floorZ ?? 0) / 100, o.scene.offsetCm[1] / 100).multiply(CONV);

/** Plain body placement used by the app's poses: hip joints at (x, z, y), heading and pitch. */
const bodyMatrix = (s: BodyState, b: Body) =>
  tr(s.x / 1000, s.z / 1000, s.y / 1000)
    .multiply(ry(-s.heading))
    .multiply(new THREE.Matrix4().makeRotationAxis(X, THREE.MathUtils.degToRad(s.pitch)))
    .multiply(tr(-b.rt.hipMid.x, -b.rt.hipMid.y, -b.rt.hipMid.z))
    .multiply(CONV);

// ------------------------------------------------------------------ posing

interface Frame { m: THREE.Matrix4; q: THREE.Quaternion[]; root: THREE.Vector3; pelvis: THREE.Vector3 }

const fromClip = (o: LoadedOriginal, spec: PersonSpec, anim: AnimData, b: Body, src: Extract<Src, { kind: 'clip' }>): Frame => {
  const m = anchorMatrix(src.anchor).multiply(recordingSpace(o)).multiply(ueMatrix(sampleTrack(spec.track, src.tau)));
  const f = Math.max(0, Math.min(anim.frames - 1, src.tau * spec.animFps));
  const i0 = Math.floor(f), i1 = Math.min(anim.frames - 1, i0 + 1), a = f - i0;
  const nb = BONES.length;
  const q: THREE.Quaternion[] = [];
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  for (let i = 0; i < nb; i++) {
    const k0 = (i0 * nb + i) * 4, k1 = (i1 * nb + i) * 4;
    qa.set(anim.quats[k0], -anim.quats[k0 + 1], anim.quats[k0 + 2], -anim.quats[k0 + 3]);
    qb.set(anim.quats[k1], -anim.quats[k1 + 1], anim.quats[k1 + 2], -anim.quats[k1 + 3]);
    q.push(new THREE.Quaternion().slerpQuaternions(qa, qb, a).normalize());
  }
  const pos = (k: number) => {
    const p0 = i0 * 6 + k * 3, p1 = i1 * 6 + k * 3, T = anim.trans;
    return new THREE.Vector3(T[p0] + (T[p1] - T[p0]) * a, -(T[p0 + 1] + (T[p1 + 1] - T[p0 + 1]) * a), T[p0 + 2] + (T[p1 + 2] - T[p0 + 2]) * a);
  };
  void b;
  return { m, q, root: pos(0), pelvis: pos(1) };
};

const fromPose = (b: Body, s: BodyState): Frame => ({
  m: bodyMatrix(s, b),
  q: poseLocals(b.rt, s.pose, []),
  root: b.restRoot.clone(),
  pelvis: b.restPelvis.clone(),
});

const blend = (A: Frame, B: Frame, w: number): Frame => {
  if (w <= 0) return A;
  if (w >= 1) return B;
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
  const pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  A.m.decompose(pa, qa, sa);
  B.m.decompose(pb, qb, sb);
  const m = new THREE.Matrix4().compose(pa.lerp(pb, w), qa.slerp(qb, w), sa.lerp(sb, w));
  return { m, q: A.q.map((q, i) => q.clone().slerp(B.q[i], w)), root: A.root.clone().lerp(B.root, w), pelvis: A.pelvis.clone().lerp(B.pelvis, w) };
};

const apply = (b: Body, f: Frame) => {
  b.root.matrix.copy(f.m);
  b.root.matrixWorldNeedsUpdate = true;
  b.rt.bones.forEach((bone, i) => { if (bone) bone.quaternion.copy(f.q[i]); });
  b.rig.bones.root.position.copy(f.root);
  b.rig.bones.pelvis.position.copy(f.pelvis);
};

// ------------------------------------------------------------------ component

export const PersonaActors = ({ built, settings, live }: { built: BuiltActivity; settings: ActivitySettings; live: { person?: unknown; helper?: unknown; chair?: THREE.Object3D } }) => {
  const assetVersion = useStore((s) => s.assetVersion);
  const o = getOriginal(P2_ID);
  const [cast, setCast] = useState<Cast | null>(null);
  const chair = useMemo(() => (settings.chair === 'manual' ? buildManualChair() : buildPowerChair('#3a4250')), [settings.chair]);

  useEffect(() => {
    let cancelled = false;
    if (!o) return;
    buildCast(o, true).then((c) => { if (!cancelled) setCast(c); }).catch((e) => console.error('Persona 2', e));
    return () => { cancelled = true; };
  }, [o, assetVersion]);

  useEffect(() => {
    live.chair = chair.root;
    live.person = cast?.person.rig.head ? { head: cast.person.rig.head } : undefined;
    live.helper = cast?.carer?.rig.head && built.mh?.carer ? { head: cast.carer.rig.head } : undefined;
  }, [cast, chair, live, built]);

  useFrame(() => {
    const t = useStore.getState().time;
    const c = built.chair(t);
    chair.root.position.set(c.x / 1000, 0, c.y / 1000);
    chair.root.rotation.y = THREE.MathUtils.degToRad(-c.heading);
    for (const w of chair.wheels) w.obj.rotation.x = c.wheelTurn / 1000 / w.radius;
    if (!o || !cast || !built.mh) return;
    const sc = o.scene;
    const frameFor = (b: Body, spec: PersonSpec, anim: AnimData, src: Src, pose: () => BodyState): Frame =>
      src.kind === 'clip' ? fromClip(o, spec, anim, b, src) : fromPose(b, pose());
    const mix = (b: Body, spec: PersonSpec, anim: AnimData, m: Mix, pose: () => BodyState) => {
      const A = frameFor(b, spec, anim, m.a, pose);
      apply(b, m.b && m.w > 0 ? blend(A, frameFor(b, spec, anim, m.b, pose), m.w) : A);
    };
    mix(cast.person, sc.person, o, built.mh.person(t), () => built.person(t));
    if (cast.carer) {
      const cm = built.mh.carer?.(t);
      cast.carer.root.visible = !!cm && (cm.a.kind === 'clip' || !!built.helper);
      if (cm && cast.carer.root.visible && sc.helpers?.[0] && o.helpers[0]) mix(cast.carer, sc.helpers[0], o.helpers[0], cm, () => built.helper!(t));
    }
    if (cast.hoist) {
      const hm = built.mh.hoist?.(t);
      cast.hoist.visible = !!hm && hm.a.kind === 'clip';
      if (hm && hm.a.kind === 'clip') {
        const hp = sc.props.find((p) => p.file)!;
        cast.hoist.matrix.copy(anchorMatrix(hm.a.anchor).multiply(recordingSpace(o)).multiply(ueMatrix(sampleTrack(hp.track, hm.a.tau), hp.scale ?? 1)));
        cast.hoist.matrixWorldNeedsUpdate = true;
      }
    }
  });

  return (
    <>
      <primitive object={chair.root} />
      {cast && <primitive object={cast.person.root} />}
      {cast?.carer && <primitive object={cast.carer.root} />}
      {cast?.hoist && <primitive object={cast.hoist} />}
    </>
  );
};
