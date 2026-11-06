import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// In-memory registry of imported 3D models (glTF/GLB or FBX).
// Imported files stay on this computer – nothing is uploaded anywhere.

export interface Asset {
  id: string;
  name: string;
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  size: THREE.Vector3; // metres
  minY: number;
  centre: THREE.Vector3; // footprint centre, metres
}

export const ASSETS = new Map<string, Asset>();

const finish = (id: string, name: string, scene: THREE.Object3D, clips: THREE.AnimationClip[], unitScale = 1): Asset => {
  scene.scale.multiplyScalar(unitScale);
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(scene);
  const size = bb.getSize(new THREE.Vector3());
  const centre = bb.getCenter(new THREE.Vector3());
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  const a: Asset = { id, name, scene, clips, size, minY: bb.min.y, centre };
  ASSETS.set(id, a);
  return a;
};

export const loadModelFile = async (file: File, id: string): Promise<Asset> => {
  const url = URL.createObjectURL(file);
  try {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.fbx')) {
      const obj = await new FBXLoader().loadAsync(url);
      // FBX exported from Unreal/Mixamo is usually in centimetres
      const bb = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
      const unit = Math.max(bb.x, bb.y, bb.z) > 20 ? 0.01 : 1;
      return finish(id, file.name, obj, obj.animations ?? [], unit);
    }
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);
    const gltf: GLTF = await loader.loadAsync(url);
    return finish(id, file.name, gltf.scene, gltf.animations);
  } finally {
    URL.revokeObjectURL(url);
  }
};
