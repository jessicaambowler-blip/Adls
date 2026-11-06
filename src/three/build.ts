import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fabricTexture, woodGrain } from './textures';

// Shared helpers for building procedural models. Units: metres.

const matCache = new Map<string, THREE.Material>();

export const std = (color: string, roughness = 0.7, metalness = 0) =>
  cached(`std:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

export const M = {
  get ceramic() { return cached('ceramic', () => new THREE.MeshPhysicalMaterial({ color: '#fbfbf8', roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.1 })); },
  get chrome() { return cached('chrome', () => new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.12, metalness: 1 })); },
  get steel() { return cached('steel', () => new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.35, metalness: 0.9 })); },
  get aluminium() { return cached('alu', () => new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.3, metalness: 0.85 })); },
  get blackMetal() { return cached('blackmetal', () => new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.45, metalness: 0.6 })); },
  get rubber() { return cached('rubber', () => new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.9 })); },
  get blackFabric() { return cached('blackfabric', () => new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.95, map: fabricTexture() })); },
  get oak() { return cached('oak', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, map: woodGrain() })); },
  get walnut() { return cached('walnut', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, map: woodGrain('walnut', [120, 85, 60]) })); },
  get whiteLaminate() { return cached('whitelam', () => new THREE.MeshStandardMaterial({ color: '#f2f0ec', roughness: 0.45 })); },
  get glass() { return cached('glass', () => new THREE.MeshPhysicalMaterial({ color: '#cfe6f2', roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.28, metalness: 0 })); },
  get mirror() { return cached('mirror', () => new THREE.MeshStandardMaterial({ color: '#e8f0f4', roughness: 0.04, metalness: 0.75, envMapIntensity: 1.6 })); },
  get stone() { return cached('stone', () => new THREE.MeshStandardMaterial({ color: '#e4e1db', roughness: 0.3 })); },
  get linen() { return cached('linen', () => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.95, map: fabricTexture() })); },
};

function cached<T extends THREE.Material>(k: string, f: () => T): T {
  if (!matCache.has(k)) matCache.set(k, f());
  return matCache.get(k) as T;
}

export const fabric = (color: string) => cached(`fabric:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.92, map: fabricTexture() }));
export const paint = (color: string, roughness = 0.8) => cached(`paint:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness }));

export const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number], rot?: [number, number, number]) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  return m;
};

export const rbox = (w: number, h: number, d: number, r = 0.01, seg = 3) =>
  new RoundedBoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001), seg, Math.min(r, w / 2 - 0.0005, h / 2 - 0.0005, d / 2 - 0.0005));

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** a box whose base sits at y (centre at x,z) */
export const boxOn = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, r = 0.004) => mesh(r > 0 ? rbox(w, h, d, r) : box(w, h, d), mat, [x, y + h / 2, z]);

export const cyl = (rTop: number, rBot: number, h: number, seg = 24) => new THREE.CylinderGeometry(rTop, rBot, h, seg);

/** tube following a list of points */
export const tube = (pts: [number, number, number][], radius: number, mat: THREE.Material, tension = 0.1) => {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension);
  return mesh(new THREE.TubeGeometry(curve, Math.max(8, pts.length * 12), radius, 12, false), mat);
};

/** straight rod between two points */
export const rod = (a: [number, number, number], b: [number, number, number], radius: number, mat: THREE.Material, seg = 12) => {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const L = A.distanceTo(B);
  const m = mesh(cyl(radius, radius, L, seg), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
};

/**
 * Tapered, rounded limb hanging DOWN from the origin along -y (lathe geometry).
 * bulge > 0 gives a muscular swell in the upper third.
 */
export const limbGeometry = (length: number, r1: number, r2: number, bulge = 0.12, capScale = 0.7) => {
  const pts: THREE.Vector2[] = [];
  const N = 8;
  // bottom cap (from pole up to equator)
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r2 * Math.sin(a)), -length - r2 * capScale * Math.cos(a)));
  }
  const M2 = 12;
  for (let i = 1; i < M2; i++) {
    const t = 1 - i / M2; // 1 at bottom … 0 at top
    const r = r1 + (r2 - r1) * t;
    const swell = 1 + bulge * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.4)) * (t > 0.3 ? 1 : t / 0.3);
    pts.push(new THREE.Vector2(r * swell, -length * t));
  }
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0.0001, r1 * Math.cos(a)), r1 * capScale * Math.sin(a)));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.computeVertexNormals();
  return g;
};

/** Lathe from a list of [radius, y] pairs (bottom to top). */
export const lathe = (profile: [number, number][], seg = 32) => {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg);
  g.computeVertexNormals();
  return g;
};

export const enableShadows = (o: THREE.Object3D, cast = true, receive = true) => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) { c.castShadow = cast; c.receiveShadow = receive; }
  });
  return o;
};
