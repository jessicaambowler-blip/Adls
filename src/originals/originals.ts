// Original VisADLs recordings (exported from the Unreal project ADLs_Final).
//
// Each recording lives in public/originals/<folder>/ (not committed to git – it contains
// MetaHumans and research participants' motion capture) and consists of:
//   scene.json  – where everything is over time (Unreal units: cm, Z up, left-handed)
//   anim.z      – each person's recorded body movement (zlib, see tools/unreal/export_baked_anims.py)
//   *.fbx       – each person's body, face and clothes; the bed parts; the hoist bar
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
  // hosted preview and the single-file version get each binary file as <name>.b64.json
  if (import.meta.env?.VITE_HOSTED === '1' || import.meta.env?.VITE_STANDALONE === '1') {
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

export interface PersonSpec {
  label: string; body: string; face: string; clothes: string[]; anim: string; animFps: number;
  /** skin colour (placeholder until the original textures are exported) */
  skin?: string;
  /** world transform of the person's Body component over time */
  track: Track;
}

export interface OriginalSceneData {
  id: string;
  title: string;
  duration: number;
  offsetCm: [number, number];
  /** height of the room's floor in Unreal (cm); everything is lowered by this */
  floorZ?: number;
  room: [number, number];
  person: PersonSpec;
  /** other people in the recording (e.g. a carer) */
  helpers?: PersonSpec[];
  props: { label: string; file?: string; builtin?: string; scale?: number; track: Track }[];
  bed: { file: string; world: number[] }[];
  /**
   * Where the person ends up lying in the original bed, so the transfer can be fitted to any bed:
   * lateral position (Unreal X) and head-end position (Unreal Y) of the original mattress, its top
   * above the floor, its plan rotation, and the time window of the hoist transfer.
   */
  bedFit?: { lateralX: number; headEndY: number; topCm: number; rotation: number; transfer: [number, number] };
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
    blurb: 'Original VisADLs motion capture: wheeled to the bedside in a powered chair, then transferred to bed with a hoist by a carer (5 min).',
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

export interface AnimData {
  /** per frame: root xyz, pelvis xyz (Unreal, parent-relative) */
  trans: Float32Array;
  /** per frame: quaternion xyzw for each of BONES (Unreal, parent-relative) */
  quats: Float32Array;
  frames: number;
}

export interface LoadedOriginal extends AnimData {
  rec: OriginalRecording;
  scene: OriginalSceneData;
  /** animation of each of scene.helpers, in the same order */
  helpers: AnimData[];
}

const loaded = new Map<string, LoadedOriginal>();
const loading = new Map<string, Promise<LoadedOriginal | null>>();
const available = new Map<string, boolean>();

export const getOriginal = (id?: string) => (id ? loaded.get(id) : undefined);
export const originalAvailable = (id: string) => available.get(id) === true;
/** this copy of the app definitely doesn't include the recording */
export const originalMissing = (id: string) => available.get(id) === false;

const inflate = async (buf: ArrayBuffer) =>
  new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();

const loadAnim = async (url: string): Promise<AnimData> => {
  const raw = await inflate(await fetchBinary(url));
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
  return { trans, quats, frames };
};

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
      const main = await loadAnim(rec.folder + scene.person.anim);
      const helpers = await Promise.all((scene.helpers ?? []).map((h) => loadAnim(rec.folder + h.anim)));
      const l: LoadedOriginal = { rec, scene, ...main, helpers };
      loaded.set(id, l);
      available.set(id, true);
      useStore.getState().bumpAssets();
      return l;
    } catch (e) {
      if ((globalThis as { __dbg?: boolean }).__dbg) console.error(e);
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

// ------------------------------------------------------------------ fitting the transfer to the room's bed

export interface BedFit {
  /** anchor in the original bed (plan mm): lying position across the bed, at the head end */
  from: { x: number; y: number };
  /** the same anchor on the bed in the current layout */
  to: { x: number; y: number };
  /** extra rotation (degrees, clockwise in plan) */
  turn: number;
  /** change of mattress height (mm) */
  lift: number;
  transfer: [number, number];
}

/** Map the original lying spot onto a bed item (centre of its width, at its head end). */
export const fitToBed = (scene: OriginalSceneData, bed: { x: number; y: number; w: number; d: number; h: number; rotation: number }): BedFit | undefined => {
  const f = scene.bedFit;
  if (!f) return undefined;
  const from = toPlan(scene, f.lateralX, f.headEndY);
  // head end of a bed item is its back (local -y)
  const a = ((bed.rotation % 360) * Math.PI) / 180;
  const to = { x: bed.x + (d0(bed) * Math.sin(a)), y: bed.y - d0(bed) * Math.cos(a) };
  return { from, to, turn: bed.rotation - f.rotation, lift: bed.h - f.topCm * 10, transfer: f.transfer };
};
const d0 = (bed: { d: number }) => bed.d / 2;

/** How far into the transfer (0 before the lift, 1 once over the bed), eased. */
export const fitWeight = (fit: BedFit | undefined, t: number) => {
  if (!fit) return 0;
  const [a, b] = fit.transfer;
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Apply a (partial) bed fit to a plan point. */
export const fitPoint = (fit: BedFit | undefined, w: number, p: { x: number; y: number }) => {
  if (!fit || w <= 0) return p;
  const ang = ((fit.turn * w) * Math.PI) / 180;
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = p.x - fit.from.x, dy = p.y - fit.from.y;
  const ox = fit.from.x + (fit.to.x - fit.from.x) * w, oy = fit.from.y + (fit.to.y - fit.from.y) * w;
  return { x: ox + dx * c - dy * s, y: oy + dx * s + dy * c };
};
