import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { BuiltActivity } from '../activities/activities';
import { BONES, fitPoint, fitWeight, getOriginal, sampleTrack, type AnimData, type LoadedOriginal, type PersonSpec } from '../originals/originals';
import { buildPerson, loadFbx, mat, setUE, type PersonRig } from './metahuman';
import { useStore } from '../model/store';
import { buildPowerChair } from './wheelchair';

// Plays an original VisADLs recording: the real MetaHuman body/face/clothes driven by the recorded
// motion, the original bed and hoist bar, and the app's powered wheelchair following the original
// wheelchair's path. See originals.ts for the coordinate conventions.

interface Rig {
  root: THREE.Group; // FBX space container: things that stay where they were recorded
  fitted: THREE.Group; // FBX space container: the person and the hoist, bent onto the room's bed
  person: PersonRig;
  helpers: PersonRig[];
  props: { obj: THREE.Object3D; idx: number }[];
}

const buildRig = async (o: LoadedOriginal): Promise<Rig> => {
  const sc = o.scene;
  const base = o.rec.folder;
  const root = new THREE.Group();
  const fitted = new THREE.Group();
  const person = await buildPerson(sc.person, base, fitted);
  const helpers: PersonRig[] = [];
  for (const h of sc.helpers ?? []) helpers.push(await buildPerson(h, base, root));
  // (the recording's own bed is not shown: the room's bed is used instead)
  // moving props with their own model (hoist bar)
  const props: Rig['props'] = [];
  for (const [i, p] of sc.props.entries()) {
    if (!p.file) continue;
    const g = await loadFbx(base + p.file);
    g.traverse((x) => { if ((x as THREE.Mesh).isMesh) { (x as THREE.Mesh).material = mat('#d7dbe0', 0.35, 0.6); x.castShadow = true; } });
    const holder = new THREE.Group();
    holder.add(g);
    fitted.add(holder);
    props.push({ obj: holder, idx: i });
  }
  return { root, fitted, person, helpers, props };
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
  const fitRef = useMemo(() => new THREE.Group(), []);

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
    // bend the person and the hoist onto the room's bed during the transfer
    const fit = built.bedFit;
    const w = fitWeight(fit, t);
    if (fit && w > 0) {
      const a = fitPoint(fit, w, { x: 0, y: 0 });
      fitRef.position.set(a.x / 1000, (fit.lift * w) / 1000, a.y / 1000);
      fitRef.rotation.y = THREE.MathUtils.degToRad(-fit.turn * w);
    } else {
      fitRef.position.set(0, 0, 0);
      fitRef.rotation.y = 0;
    }
    // the app's powered wheelchair follows the original wheelchair's path
    const c = built.chair(t);
    chair.root.position.set(c.x / 1000, 0, c.y / 1000);
    chair.root.rotation.y = THREE.MathUtils.degToRad(-c.heading);
    for (const w of chair.wheels) w.obj.rotation.x = c.wheelTurn / 1000 / w.radius;
  });

  if (!o) return null;
  const off = o.scene.offsetCm;
  return (
    <>
      <primitive object={chair.root} />
      {rig && (
        <>
          <group position={[off[0] / 100, 0, off[1] / 100]}>
            <group position-y={-(o.scene.floorZ ?? 0) / 100} rotation-x={-Math.PI / 2} scale={0.01}>
              <primitive object={rig.root} />
            </group>
          </group>
          <primitive object={fitRef}>
            <group position={[off[0] / 100, 0, off[1] / 100]}>
              <group position-y={-(o.scene.floorZ ?? 0) / 100} rotation-x={-Math.PI / 2} scale={0.01}>
                <primitive object={rig.fitted} />
              </group>
            </group>
          </primitive>
        </>
      )}
    </>
  );
};
