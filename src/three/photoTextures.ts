import * as THREE from 'three';
import grass from '../assets/textures/grass.jpg';
import grassN from '../assets/textures/grass_n.jpg';
import brick from '../assets/textures/brick.jpg';
import brickN from '../assets/textures/brick_n.jpg';
import pavers from '../assets/textures/pavers.jpg';
import paversN from '../assets/textures/pavers_n.jpg';
import concrete from '../assets/textures/concrete.jpg';
import concreteN from '../assets/textures/concrete_n.jpg';
import gravel from '../assets/textures/gravel.jpg';
import gravelN from '../assets/textures/gravel_n.jpg';
import timber from '../assets/textures/timber.jpg';
import timberN from '../assets/textures/timber_n.jpg';
import tiles from '../assets/textures/tiles.jpg';
import tilesN from '../assets/textures/tiles_n.jpg';
import carpet from '../assets/textures/carpet.jpg';
import carpetN from '../assets/textures/carpet_n.jpg';
import planks from '../assets/textures/planks.jpg';
import planksN from '../assets/textures/planks_n.jpg';
import sky from '../assets/textures/sky.jpg';

// Photographic surface textures (ambientCG, CC0) and the sky (Poly Haven, CC0). Each image is loaded
// once and shared; materials get their own copy only to set how often it repeats.

export type Photo = 'grass' | 'brick' | 'pavers' | 'concrete' | 'gravel' | 'timber' | 'tiles' | 'carpet' | 'planks';

const URLS: Record<Photo, [string, string]> = {
  grass: [grass, grassN], brick: [brick, brickN], pavers: [pavers, paversN], concrete: [concrete, concreteN], gravel: [gravel, gravelN],
  timber: [timber, timberN], tiles: [tiles, tilesN], carpet: [carpet, carpetN], planks: [planks, planksN],
};
/** how many metres one copy of each image covers */
export const PHOTO_SIZE: Record<Photo, number> = { grass: 2.5, brick: 1.4, pavers: 1.6, concrete: 2.5, gravel: 1.2, timber: 1.8, tiles: 2.4, carpet: 1.2, planks: 1.6 };
/** average colour of each image (0–255), so a chosen colour can tint it */
export const PHOTO_MEAN: Record<Photo, [number, number, number]> = {
  grass: [96, 109, 48], brick: [185, 148, 107], pavers: [160, 155, 142], concrete: [184, 184, 184], gravel: [141, 139, 118],
  timber: [108, 67, 20], tiles: [248, 248, 247], carpet: [188, 176, 147], planks: [80, 62, 46],
};

const loader = new THREE.TextureLoader();
const base = new Map<string, THREE.Texture>();
const load = (url: string, srgb: boolean) => {
  let t = base.get(url);
  if (!t) {
    t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    base.set(url, t);
  }
  return t;
};
const repeated = (url: string, srgb: boolean, rx: number, ry: number, rot = 0) => {
  const t = load(url, srgb).clone();
  t.repeat.set(rx, ry);
  if (rot) { t.rotation = rot; t.center.set(0.5, 0.5); }
  t.needsUpdate = true;
  return t;
};

/** A material showing `name` over a w × h metre surface (tinted to `colour` if given). */
export const photoMaterial = (name: Photo, w: number, h: number, opts: { colour?: string; roughness?: number; normal?: number; rotate?: boolean } = {}) => {
  const s = PHOTO_SIZE[name], [cu, nu] = URLS[name], rot = opts.rotate ? Math.PI / 2 : 0;
  const m = new THREE.MeshStandardMaterial({
    map: repeated(cu, true, w / s, h / s, rot),
    normalMap: repeated(nu, false, w / s, h / s, rot),
    roughness: opts.roughness ?? 0.85,
    metalness: 0,
  });
  m.normalScale.setScalar(opts.normal ?? 0.8);
  if (opts.colour) {
    // the image is multiplied by the colour in linear space: scale so its average becomes the swatch
    const c = new THREE.Color(opts.colour), b = new THREE.Color().setRGB(...(PHOTO_MEAN[name].map((v) => v / 255) as [number, number, number]), THREE.SRGBColorSpace);
    m.color.setRGB(c.r / b.r, c.g / b.g, c.b / b.b);
  }
  m.userData.own = true;
  return m;
};

let skyTex: THREE.Texture | null = null;
/** The sky all round (a panorama). */
export const skyTexture = () => {
  if (!skyTex) {
    skyTex = loader.load(sky);
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    skyTex.colorSpace = THREE.SRGBColorSpace;
  }
  return skyTex;
};
