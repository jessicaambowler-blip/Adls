import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Item, ItemKind } from '../model/types';
import { television } from './furniture';

// Realistic furniture: scanned/modelled products from the Amazon Berkeley Objects dataset (credit:
// Amazon.com, CC BY 4.0 – see src/assets/models/CREDITS.md). Each model is fitted to the item's own
// size, so the plan, clearances and routes stay exactly as measured; the app's simple models stand
// in while a model loads, and for everything without one (bathroom, equipment, outdoor).

// each model is its own small chunk, loaded the first time that kind of furniture appears
const FILES = import.meta.glob('../assets/models/*.glb', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>;
const loaderFor = (kind: ItemKind) => FILES[`../assets/models/${kind}.glb`];
export const hasRealModel = (kind: ItemKind) => !!loaderFor(kind);

/** Boxy furniture is fitted to the item's height as well; seats and beds keep their proportions upright. */
const FIT_HEIGHT = new Set<ItemKind>(['dining-table', 'desk', 'tv-unit', 'bedside-table', 'drawers', 'wardrobe', 'hall-table']);

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

/** The realistic model for an item, sized to it (local origin at the floor centre, front towards +z), or null. */
export const realModel = async (it: Item): Promise<THREE.Object3D | null> => {
  const src = await load(it.kind);
  if (!src) return null;
  const w = it.w / 1000, d = it.d / 1000, h = it.h / 1000;
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
  const ky = it.kind === 'rug' ? 1 : it.kind === 'tv-unit' ? TV_TOP / src.size.y : FIT_HEIGHT.has(it.kind) ? h / src.size.y : Math.sqrt(kx * kz);
  const fitted = new THREE.Group();
  fitted.add(mid);
  fitted.scale.set(kx, ky, kz);
  const out = new THREE.Group();
  out.add(fitted);
  if (it.kind === 'tv-unit') out.add(television(w, h, TV_TOP));
  out.userData.real = true;
  return out;
};
