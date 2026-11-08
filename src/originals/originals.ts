// Original VisADLs recordings (exported from the Unreal project ADLs_Final).
//
// Each recording lives in public/originals/<folder>/ (not committed to git – it contains
// MetaHumans and research participants' motion capture) and consists of:
//   scene.json  – where everything is over time (Unreal units: cm, Z up, left-handed)
//   anim.z      – the person's recorded body movement (zlib, see tools/unreal/export_baked_anims.py)
//   *.fbx       – the person's body, face and clothes; the bed parts; the hoist bar
//
// Coordinate conventions
//   Unreal (X, Y, Z)  ->  plan mm  (X*10 + offset, Y*10 + offset)  ->  3D metres (x = X/100, y = Z/100, z = Y/100)
//   FBX files exported by Unreal mirror Y. A transform in Unreal is converted to FBX space with
//   position (x, -y, z) and quaternion (x, -y, z, -w); FBX space is shown in 3D through a group
//   rotated -90° about X and scaled 0.01.

import { useStore } from '../model/store';

/**
 * Fetch a binary file. The hosted preview cannot serve binary files directly, so there each file is
 * published as <name>.b64.json ({"b64": "..."}) and decoded here.
 */
export const fetchBinary = async (url: string): Promise<ArrayBuffer> => {
  if (import.meta.env.VITE_HOSTED === '1') {
    const j = await (await fetch(`${url}.b64.json`)).json();
    const bin = atob(j.b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.arrayBuffer();
};

export interface Track { fps: number; frames: number; data: number[] }

export interface OriginalSceneData {
  id: string;
  title: string;
  duration: number;
  offsetCm: [number, number];
  room: [number, number];
  person: {
    label: string; body: string; face: string; clothes: string[]; anim: string; animFps: number; track: Track;
  };
  props: { label: string; file?: string; builtin?: string; scale?: number; track: Track }[];
  bed: { file: string; world: number[] }[];
  bedFootprint: { minX: number; maxX: number; minY: number; maxY: number; top: number };
  phases: { t: number; label: string }[];
}

export interface OriginalRecording {
  id: string;
  folder: string;
  title: string;
  short: string;
  blurb: string;
}

export const ORIGINALS: OriginalRecording[] = [
  {
    id: 'p2-bed-transfer',
    folder: 'originals/p2/',
    title: 'Persona 2 – hoist transfer to bed',
    short: 'Persona 2 · bed transfer',
    blurb: 'Original VisADLs motion capture: wheeled to the bedside in a powered chair, then transferred to bed with a hoist (5 min).',
  },
];

export const BONES = (() => {
  const side = ['clavicle', 'upperarm', 'lowerarm', 'hand', 'upperarm_twist_01', 'upperarm_twist_02', 'lowerarm_twist_01', 'lowerarm_twist_02',
    'thumb_01', 'thumb_02', 'thumb_03', 'index_metacarpal', 'index_01', 'index_02', 'index_03', 'middle_metacarpal', 'middle_01', 'middle_02', 'middle_03',
    'ring_metacarpal', 'ring_01', 'ring_02', 'ring_03', 'pinky_metacarpal', 'pinky_01', 'pinky_02', 'pinky_03',
    'thigh', 'calf', 'foot', 'ball', 'thigh_twist_01', 'thigh_twist_02', 'calf_twist_01', 'calf_twist_02'];
  return ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05', 'neck_01', 'neck_02', 'head',
    ...side.map((b) => `${b}_l`), ...side.map((b) => `${b}_r`)];
})();

export interface LoadedOriginal {
  rec: OriginalRecording;
  scene: OriginalSceneData;
  /** per frame: root xyz, pelvis xyz (Unreal, parent-relative) */
  trans: Float32Array;
  /** per frame: quaternion xyzw for each of BONES (Unreal, parent-relative) */
  quats: Float32Array;
  frames: number;
}

const loaded = new Map<string, LoadedOriginal>();
const loading = new Map<string, Promise<LoadedOriginal | null>>();
const available = new Map<string, boolean>();

export const getOriginal = (id?: string) => (id ? loaded.get(id) : undefined);
export const originalAvailable = (id: string) => available.get(id) === true;

const inflate = async (buf: ArrayBuffer) =>
  new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();

export const loadOriginal = (id: string): Promise<LoadedOriginal | null> => {
  const hit = loading.get(id);
  if (hit) return hit;
  const rec = ORIGINALS.find((r) => r.id === id);
  if (!rec) return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await fetch(`${rec.folder}scene.json`);
      if (!res.ok) throw new Error(String(res.status));
      const scene = (await res.json()) as OriginalSceneData;
      const raw = await inflate(await fetchBinary(rec.folder + scene.person.anim));
      const nb = BONES.length;
      const frameBytes = 24 + nb * 8;
      const frames = Math.floor(raw.byteLength / frameBytes);
      const dv = new DataView(raw);
      const trans = new Float32Array(frames * 6);
      const quats = new Float32Array(frames * nb * 4);
      for (let f = 0; f < frames; f++) {
        const o = f * frameBytes;
        for (let k = 0; k < 6; k++) trans[f * 6 + k] = dv.getFloat32(o + k * 4, true);
        for (let b = 0; b < nb; b++) for (let k = 0; k < 4; k++) quats[(f * nb + b) * 4 + k] = dv.getInt16(o + 24 + b * 8 + k * 2, true) / 32767;
      }
      const l: LoadedOriginal = { rec, scene, trans, quats, frames };
      loaded.set(id, l);
      available.set(id, true);
      useStore.getState().bumpAssets();
      return l;
    } catch {
      available.set(id, false);
      useStore.getState().bumpAssets();
      return null;
    }
  })();
  loading.set(id, p);
  return p;
};

/** Check which recordings are present in this build (they are not in the public repository). */
export const probeOriginals = () => {
  for (const r of ORIGINALS) {
    fetch(`${r.folder}scene.json`, { method: 'HEAD' })
      .then((res) => { available.set(r.id, res.ok); useStore.getState().bumpAssets(); })
      .catch(() => { available.set(r.id, false); });
  }
};

// ------------------------------------------------------------------ sampling helpers (Unreal units)

/** Interpolated transform [x,y,z,qx,qy,qz,qw] from a track at time t. */
export const sampleTrack = (tr: Track, t: number): number[] => {
  const f = Math.max(0, Math.min(tr.frames - 1, t * tr.fps));
  const i0 = Math.floor(f), i1 = Math.min(tr.frames - 1, i0 + 1), a = f - i0;
  const A = tr.data.slice(i0 * 7, i0 * 7 + 7), B = tr.data.slice(i1 * 7, i1 * 7 + 7);
  const out = [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * a);
  // nlerp quaternions (frames are close together)
  let dot = A[3] * B[3] + A[4] * B[4] + A[5] * B[5] + A[6] * B[6];
  const s = dot < 0 ? -1 : 1;
  dot = 0;
  const q = [3, 4, 5, 6].map((k) => A[k] * (1 - a) + B[k] * s * a);
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [...out, ...q.map((v) => v / n)];
};

/** Unreal yaw (degrees) of a quaternion, about Z. */
export const ueYaw = (q: number[]) => (Math.atan2(2 * (q[3] * q[2] + q[0] * q[1]), 1 - 2 * (q[1] * q[1] + q[2] * q[2])) * 180) / Math.PI;

export const toPlan = (scene: OriginalSceneData, X: number, Y: number) => ({
  x: (X + scene.offsetCm[0]) * 10,
  y: (Y + scene.offsetCm[1]) * 10,
});
