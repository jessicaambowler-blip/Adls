import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Item, ItemKind } from '../model/types';
import { gardenBedBox, television } from './furniture';

// Realistic furniture: scanned/modelled products from the Amazon Berkeley Objects dataset (credit:
// Amazon.com, CC BY 4.0 – see src/assets/models/CREDITS.md). Each model is fitted to the item's own
// size, so the plan, clearances and routes stay exactly as measured; the app's simple models stand
// in while a model loads, and for everything without one (bathroom, equipment, outdoor).

// each model is its own small chunk, loaded the first time that kind of furniture appears
const FILES = import.meta.glob('../assets/models/*.glb', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>;
const loaderFor = (kind: ItemKind) => FILES[`../assets/models/${kind}.glb`];
export const hasRealModel = (kind: ItemKind) => !!loaderFor(kind);

/**
 * How a model takes the item's size. Width and depth always match the item; height:
 *  box     – matches the item's height too (cabinets, tables, rails with a set size)
 *  upright – keeps the model's proportions (seats, beds)
 *  top     – keeps its proportions, raised so its top is at the item's height (wall basin rim, shower seat)
 *  centre  – keeps its proportions, centred on the mounting height (straight grab rail)
 */
type Fit = 'box' | 'upright' | 'top' | 'centre' | 'height';
const FIT: Partial<Record<ItemKind, Fit>> = {
  'dining-table': 'box', desk: 'box', 'tv-unit': 'box', 'bedside-table': 'box', drawers: 'box', wardrobe: 'box', 'hall-table': 'box',
  toilet: 'box', vanity: 'box', fridge: 'box', 'grab-rail-l': 'box', 'fold-rail': 'box', 'floor-rail': 'box', 'toilet-frame': 'box',
  basin: 'top', 'shower-seat': 'top', 'grab-rail': 'centre',
  'wall-art': 'box', mirror: 'box', 'air-con': 'box', 'ceiling-fan': 'top',
  // a tree's item is its trunk (what blocks the way); the model keeps its proportions at the item's height
  tree: 'height', car: 'box', 'outdoor-setting': 'box',
};

interface Src { scene: THREE.Object3D; size: THREE.Vector3; centre: THREE.Vector3; minY: number }
const cache = new Map<ItemKind, Promise<Src | null>>();
let loader: GLTFLoader | null = null;

const load = (kind: ItemKind) => {
  let p = cache.get(kind);
  if (!p) {
    const get = loaderFor(kind);
    p = !get ? Promise.resolve(null) : get().then(async (url) => {
      loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const g = await loader.loadAsync(url);
      g.scene.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g.scene);
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = kind !== 'rug';
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((x) => { const s = x as THREE.MeshStandardMaterial; if (s.map) s.map.anisotropy = 4; });
      });
      return { scene: g.scene, size: bb.getSize(new THREE.Vector3()), centre: bb.getCenter(new THREE.Vector3()), minY: bb.min.y };
    }).catch((e) => { console.warn('furniture model', kind, e); return null; });
    cache.set(kind, p);
  }
  return p;
};

/** A planter box with real shrubs along it, about 0.6 m tall, spaced along its length. */
const plantedBed = (src: Src, w: number, d: number, h: number) => {
  const out = new THREE.Group();
  out.add(gardenBedBox(w, d, h));
  const k = 0.6 / src.size.y, len = src.size.x * k, n = Math.max(1, Math.round(w / Math.max(0.5, len * 0.8)));
  for (let i = 0; i < n; i++) {
    const s = src.scene.clone(true);
    s.position.set(-src.centre.x, -src.minY, -src.centre.z);
    const g = new THREE.Group();
    g.add(s);
    g.scale.setScalar(k * (0.85 + ((i * 37) % 10) / 33));
    g.rotation.y = (i % 2) * Math.PI + (((i * 53) % 7) - 3) * 0.12;
    g.position.set(-w / 2 + (w * (i + 0.5)) / n, h - 0.01, ((i % 3) - 1) * d * 0.15);
    out.add(g);
  }
  out.userData.real = true;
  return out;
};

/** The realistic model for an item, sized to it (local origin at the floor centre, front towards +z), or null. */
export const realModel = async (it: Item): Promise<THREE.Object3D | null> => {
  const src = await load(it.kind);
  if (!src) return null;
  const w = it.w / 1000, d = it.d / 1000, h = it.h / 1000;
  if (it.kind === 'garden-bed') return plantedBed(src, w, d, h);
  const inner = src.scene.clone(true);
  inner.position.set(-src.centre.x, -src.minY, -src.centre.z);
  const mid = new THREE.Group();
  mid.add(inner);
  let sx = src.size.x, sz = src.size.z;
  // a rug is the same either way round: turn it to match the item's long side
  if (it.kind === 'rug' && (sx > sz) !== (w > d)) { mid.rotation.y = Math.PI / 2; [sx, sz] = [sz, sx]; }
  const kx = w / sx, kz = d / sz;
  // (a TV unit's height includes the television: the cabinet is half a metre, the TV goes on top)
  const TV_TOP = 0.5;
  const fit = FIT[it.kind] ?? 'upright';
  const ky = it.kind === 'rug' ? 1 : it.kind === 'tv-unit' ? TV_TOP / src.size.y : fit === 'box' ? h / src.size.y : fit === 'height' ? h / src.size.y : Math.sqrt(kx * kz);
  const fitted = new THREE.Group();
  fitted.add(mid);
  if (fit === 'height') fitted.scale.setScalar(ky); else fitted.scale.set(kx, ky, kz);
  const tall = src.size.y * ky;
  if (fit === 'top') fitted.position.y = h - tall;
  if (fit === 'centre') fitted.position.y = -tall / 2;
  const out = new THREE.Group();
  out.add(fitted);
  if (it.kind === 'tv-unit') out.add(television(w, h, TV_TOP));
  out.userData.real = true;
  return out;
};
