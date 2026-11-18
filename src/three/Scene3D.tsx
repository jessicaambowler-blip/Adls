import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { BuiltActivity } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { itemToPlan, layoutBounds, rotate, wallLength, wallNormal } from '../model/geometry';
import { chairFootprint } from '../model/pathfinding';
import { CHAIRS, chairOf } from '../model/catalogue';
import { useStore } from '../model/store';
import type { ActivitySettings, Item, Layout, LayoutKey } from '../model/types';
import { ASSETS } from './assets';
import { SUPPORT_PERSONA, applyPose, buildAvatar, type AvatarRig } from './avatar';
import { buildItem } from './furniture';
import { hasRealModel, realModel } from './realModels';
import { buildWalls, floorMaterial, floorMaterialOf } from './walls';
import { finishOf, roomsOf } from '../model/finishes';
import { buildManualChair, buildPowerChair, type ChairRig } from './wheelchair';
import { OriginalActors } from './OriginalActors';
import { PersonaActors } from './PersonaActors';
import { placeAt } from '../ui/placeFlow';
import { floorAt, groundAt } from '../model/ground';
import { useClearances } from '../activities/useClearances';
import { getOriginal, originalMissing } from '../originals/originals';
import { P2_ID } from '../activities/activities';

const P = (x: number, y: number, h = 0) => new THREE.Vector3(x / 1000, h / 1000, y / 1000);

interface Live {
  person?: AvatarRig;
  helper?: AvatarRig;
  chair?: THREE.Object3D;
}

// ---------------------------------------------------------------- environment & lights

const EnvironmentSetup = () => {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    scene.background = new THREE.Color('#dfe3e6');
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
};

const Lights = ({ layout, hq }: { layout: Layout; hq: boolean }) => {
  const b = layoutBounds(layout);
  const cx = (b.minX + b.maxX) / 2000, cz = (b.minY + b.maxY) / 2000;
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 1000 + 3;
  const ref = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    cam.left = -size / 2; cam.right = size / 2; cam.top = size / 2; cam.bottom = -size / 2;
    cam.near = 0.5; cam.far = 30;
    cam.updateProjectionMatrix();
  }, [cx, cz, size]);
  return (
    <>
      <hemisphereLight args={['#fdfbf7', '#b7a690', 0.55]} />
      <directionalLight
        ref={ref}
        position={[cx + 3.5, 7, cz + 2.5]}
        intensity={1.9}
        color="#fff6e8"
        castShadow
        shadow-mapSize={hq ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={4}
      />
      <pointLight position={[cx, layout.ceilingHeight / 1000 - 0.15, cz]} intensity={2.2} distance={9} decay={2} color="#ffe2b8" />
    </>
  );
};

// ---------------------------------------------------------------- building

const Walls = ({ layout }: { layout: Layout }) => {
  // rebuilt only when the building itself changes (not when furniture moves), and the old meshes freed
  const sig = JSON.stringify([layout.walls, layout.openings, layout.ceilingHeight, layout.wallColor, layout.floor, layout.labels]);
  const builds = useMemo(() => buildWalls(layout), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => builds.forEach((b) => { disposeTree(b.full); disposeTree(b.low); }), [builds]);
  const group = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const mode = useStore.getState().wallMode;
    const camAbove = camera.position.y > layout.ceilingHeight / 1000 + 0.2;
    for (const w of builds) {
      let cut = false;
      if (mode === 'low') cut = true;
      else if (mode === 'cutaway' && camAbove) {
        if (!w.exterior) cut = true;
        else cut = tmp.copy(camera.position).sub(w.mid).setY(0).dot(w.outward) > 0;
      }
      w.full.visible = !cut;
      w.low.visible = cut;
    }
  });
  return (
    <group ref={group} name="walls">
      {builds.map((w) => (
        <group key={w.wall.id}>
          <primitive object={w.full} />
          <primitive object={w.low} />
        </group>
      ))}
    </group>
  );
};

/** Free a rebuilt object's geometry, and any materials and textures made just for it. */
const disposeTree = (o: THREE.Object3D) => o.traverse((x) => {
  const m = x as THREE.Mesh;
  if (!m.isMesh) return;
  m.geometry?.dispose();
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    if (!mat?.userData?.own) continue;
    (mat as THREE.MeshStandardMaterial).map?.dispose();
    mat.dispose();
  }
});

/** Each named room's own floor, ceiling colour and light fittings (fittings only from below the ceiling). */
const RoomFinishes = ({ layout }: { layout: Layout }) => {
  const roomList = useMemo(() => roomsOf(layout).map((r) => ({ ...r, f: finishOf(layout, r.label.finish), own: r.label.finish })), [layout.walls, layout.labels, layout.floor, layout.wallColor]); // eslint-disable-line react-hooks/exhaustive-deps
  // only rebuild the floors when a room's size or finish actually changes (not on every edit)
  const roomSig = JSON.stringify(roomList.map((r) => [r.label.id, r.rect, r.f, !!r.own?.floor || !!r.own?.floorColour, !!r.own?.ceilingColour]));
  const rooms = useMemo(() => roomList, [roomSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const fittings = useRef<THREE.Group>(null);
  const H = layout.ceilingHeight / 1000;
  useFrame(({ camera }) => { if (fittings.current) fittings.current.visible = camera.position.y < H; });
  // smaller rooms sit a hair higher, so where open-plan spaces overlap the smaller one shows
  const rank = (r: { rect: { x0: number; x1: number; y0: number; y1: number } }) => rooms.filter((o) => (o.rect.x1 - o.rect.x0) * (o.rect.y1 - o.rect.y0) > (r.rect.x1 - r.rect.x0) * (r.rect.y1 - r.rect.y0)).length;
  const parts = useMemo(() => rooms.map((r) => {
    const { x0, x1, y0, y1 } = r.rect;
    const w = (x1 - x0) / 1000, d = (y1 - y0) / 1000, cx = (x0 + x1) / 2000, cz = (y0 + y1) / 2000;
    const floor = r.own?.floor || r.own?.floorColour ? floorMaterialOf(r.f.floor, r.f.floorColour, w, d) : null;
    const timber = r.f.ceiling === 'timber';
    // timber-lined ceiling: stained boards (the floorboard texture, tinted) with dark exposed beams
    const ceil = timber ? floorMaterialOf('timber', '#7a4a2c', w, d) : r.own?.ceilingColour ? new THREE.MeshStandardMaterial({ color: r.f.ceilingColour, roughness: 0.95 }) : null;
    const along = w >= d; // beams span the shorter way, about every 1.2 m
    const span = along ? w : d, n = Math.max(1, Math.round(span / 1.2) - 1);
    const beams = timber ? Array.from({ length: n }, (_, i) => -span / 2 + (span * (i + 1)) / (n + 1)) : [];
    return { key: r.label.id, w, d, cx, cz, floor, ceil, beams, along, lights: r.f.lights, lift: rank(r) * 0.0006 };
  }), [rooms]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => parts.forEach((p) => { p.floor?.map?.dispose(); p.floor?.dispose(); p.ceil?.dispose(); }), [parts]);
  const glow = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4d6', emissiveIntensity: 1.2 }), []);
  const beamMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2417', roughness: 0.7 }), []);
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e8e6e1', roughness: 0.4, metalness: 0.2 }), []);
  return (
    <group>
      {parts.map((p) => (
        <group key={p.key}>
          {p.floor && (
            <mesh rotation-x={-Math.PI / 2} position={[p.cx, 0.0015 + p.lift, p.cz]} receiveShadow material={p.floor}>
              <planeGeometry args={[p.w, p.d]} />
            </mesh>
          )}
          {p.ceil && (
            <mesh rotation-x={Math.PI / 2} position={[p.cx, H - 0.002 - p.lift, p.cz]} material={p.ceil}>
              <planeGeometry args={[p.w, p.d]} />
            </mesh>
          )}
        </group>
      ))}
      <group ref={fittings}>
        {parts.map((p) => p.beams.map((o, i) => (
          <mesh key={`${p.key}b${i}`} position={[p.cx + (p.along ? o : 0), H - 0.11, p.cz + (p.along ? 0 : o)]} material={beamMat} castShadow>
            <boxGeometry args={p.along ? [0.09, 0.2, p.d] : [p.w, 0.2, 0.09]} />
          </mesh>
        )))}
        {parts.map((p) => {
          if (p.lights === 'pendant') return (
            <group key={p.key} position={[p.cx, H, p.cz]}>
              <mesh position={[0, -0.25, 0]} material={trim}><cylinderGeometry args={[0.004, 0.004, 0.5, 6]} /></mesh>
              <mesh position={[0, -0.6, 0]} material={trim}><coneGeometry args={[0.18, 0.2, 24, 1, true]} /></mesh>
              <mesh position={[0, -0.66, 0]} material={glow}><sphereGeometry args={[0.05, 12, 8]} /></mesh>
            </group>
          );
          if (p.lights === 'batten') return (
            <mesh key={p.key} position={[p.cx, H - 0.03, p.cz]} material={glow} rotation-y={p.w > p.d ? 0 : Math.PI / 2}><boxGeometry args={[1.2, 0.05, 0.08]} /></mesh>
          );
          if (p.lights === 'downlights') {
            // about one every 1.6 m, kept off the walls
            const nx = Math.max(1, Math.round(p.w / 1.6)), nz = Math.max(1, Math.round(p.d / 1.6));
            return (
              <group key={p.key}>
                {Array.from({ length: nx * nz }, (_, i) => (
                  <mesh key={i} rotation-x={Math.PI / 2} position={[p.cx - p.w / 2 + (p.w * ((i % nx) + 0.5)) / nx, H - 0.004, p.cz - p.d / 2 + (p.d * (Math.floor(i / nx) + 0.5)) / nz]} material={glow}>
                    <circleGeometry args={[0.045, 20]} />
                  </mesh>
                ))}
              </group>
            );
          }
          return null;
        })}
      </group>
    </group>
  );
};

const Floor = ({ layout }: { layout: Layout }) => {
  const b = layoutBounds({ ...layout, items: [] });
  const t = (layout.walls[0]?.thickness ?? 110) / 2;
  const w = (b.maxX - b.minX - 2 * t) / 1000, d = (b.maxY - b.minY - 2 * t) / 1000;
  const mat = useMemo(() => floorMaterial(layout, w, d), [layout.floor, w, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const ceil = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.95 }), []);
  const all = layoutBounds(layout);
  const gy = (layout.ground ?? 0) / 1000;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[(b.minX + b.maxX) / 2000, 0, (b.minY + b.maxY) / 2000]} receiveShadow material={mat}>
        <planeGeometry args={[w + 0.02, d + 0.02]} />
      </mesh>
      {/* ceiling: only visible from below (eye-level views) */}
      <mesh rotation-x={Math.PI / 2} position={[(b.minX + b.maxX) / 2000, layout.ceilingHeight / 1000, (b.minY + b.maxY) / 2000]} material={ceil}>
        <planeGeometry args={[w + 0.2, d + 0.2]} />
      </mesh>
      {/* surrounding ground (outside the house), at the ground level */}
      <mesh rotation-x={-Math.PI / 2} position={[(all.minX + all.maxX) / 2000, gy - 0.003, (all.minY + all.maxY) / 2000]} receiveShadow>
        <planeGeometry args={[(all.maxX - all.minX) / 1000 + 14, (all.maxY - all.minY) / 1000 + 14]} />
        <meshStandardMaterial color="#cfd2cc" roughness={1} />
      </mesh>
      {/* the house's slab edge when the floor sits above the ground */}
      {gy < -0.01 && (
        <mesh position={[(b.minX + b.maxX) / 2000, gy / 2, (b.minY + b.maxY) / 2000]} receiveShadow castShadow>
          <boxGeometry args={[(b.maxX - b.minX) / 1000, -gy, (b.maxY - b.minY) / 1000]} />
          <meshStandardMaterial color="#9f9a92" roughness={0.95} />
        </mesh>
      )}
    </group>
  );
};

// ---------------------------------------------------------------- building aids

/** Turning circles on the floor (quiet dashed rings) and markers on doorways too narrow for the chair. */
const ClearanceRings = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const checks = useClearances(layoutKey);
  const on = useStore((s) => s.project.activity.showClearances !== false);
  if (!on) return null;
  const col = { ok: '#2e7d32', tight: '#b26a00', no: '#c62828' } as const;
  return (
    <group>
      {checks.map((c, i) => {
        if (c.kind === 'turn') {
          const pts = Array.from({ length: 65 }, (_, k) => { const a = (k / 64) * Math.PI * 2; return [c.at.x / 1000 + Math.cos(a) * c.need / 2000, 0.014, c.at.y / 1000 + Math.sin(a) * c.need / 2000] as [number, number, number]; });
          return <Line key={i} points={pts} color={col[c.status]} lineWidth={c.status === 'ok' ? 1.5 : 2.5} dashed dashSize={0.1} gapSize={0.07} transparent opacity={c.status === 'ok' ? 0.5 : 0.9} />;
        }
        if (c.status === 'ok') return null;
        return (
          <mesh key={i} position={[c.at.x / 1000, 2.15, c.at.y / 1000]}>
            <sphereGeometry args={[0.06, 16, 12]} />
            <meshBasicMaterial color={col[c.status]} />
          </mesh>
        );
      })}
    </group>
  );
};

/** Measuring grid on the floor: fine lines every 100 mm, strong blue lines every metre. */
const FloorGrid = ({ layout }: { layout: Layout }) => {
  const on = useStore((s) => s.grid3d && s.panel === 'room');
  const b = layoutBounds({ ...layout, items: [] });
  if (!on) return null;
  return (
    <Grid
      position={[Math.floor(b.minX / 1000), 0.004, Math.floor(b.minY / 1000)]}
      args={[60, 60]} cellSize={0.1} cellThickness={0.4} cellColor="#d3dae2" sectionSize={1} sectionThickness={0.9} sectionColor="#7aa3dc"
      fadeDistance={28} fadeStrength={1.5} infiniteGrid followCamera={false}
    />
  );
};

/** A dimension line on the floor with its measurement. */
const Dim = ({ a, b, text, lift = 0.02 }: { a: [number, number]; b: [number, number]; text: string; lift?: number }) => {
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, lift, (a[1] + b[1]) / 2];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L * 0.08, nz = dx / L * 0.08;
  return (
    <group>
      <Line points={[[a[0], lift, a[1]], [b[0], lift, b[1]]]} color="#1d2733" lineWidth={1.5} />
      {[a, b].map((p, i) => <Line key={i} points={[[p[0] - nx, lift, p[1] - nz], [p[0] + nx, lift, p[1] + nz]]} color="#1d2733" lineWidth={1.5} />)}
      <Html center position={mid} zIndexRange={[9, 0]}><div className="dim3d">{text}</div></Html>
    </group>
  );
};

/** Measurements of whatever is selected, drawn in 3D like a drawing's dimension lines. */
const SelectionDims = ({ layout }: { layout: Layout }) => {
  const sel = useStore((s) => s.selection);
  if (!sel) return null;
  if (sel.type === 'item') {
    const it = layout.items.find((i) => i.id === sel.id);
    if (!it) return null;
    const c = (lx: number, ly: number): [number, number] => { const p = itemToPlan(it, { x: lx, y: ly }); return [p.x / 1000, p.y / 1000]; };
    const hw = it.w / 2, hd = it.d / 2, off = 180;
    return (
      <group>
        <Dim a={c(-hw, hd + off)} b={c(hw, hd + off)} text={`${it.w}`} />
        <Dim a={c(hw + off, -hd)} b={c(hw + off, hd)} text={`${it.d}`} />
        {(it.elevation ?? 0) > 0 && <Html center position={[it.x / 1000, (it.elevation ?? 0) / 1000 + 0.12, it.y / 1000]}><div className="dim3d">↕ {it.elevation} mm</div></Html>}
        {it.ramp && <Html center position={[it.x / 1000, it.ramp.rise / 1000 + 0.35, it.y / 1000]}><div className="dim3d">rise {it.ramp.rise} · 1:{it.ramp.gradient}</div></Html>}
      </group>
    );
  }
  if (sel.type === 'wall') {
    const w = layout.walls.find((x) => x.id === sel.id);
    if (!w) return null;
    const n = wallNormal(w), o = w.thickness / 2 + 250;
    return <Dim a={[(w.a.x + n.x * o) / 1000, (w.a.y + n.y * o) / 1000]} b={[(w.b.x + n.x * o) / 1000, (w.b.y + n.y * o) / 1000]} text={`${Math.round(wallLength(w) - w.thickness)}`} />;
  }
  return null;
};

/** Dragging the selected furniture over the floor in 3D (snapped to the grid, one undo step). */
let drag3d: { key: LayoutKey; id: string; dx: number; dz: number } | null = null;
const startDrag3d = (key: LayoutKey, item: Item, at: THREE.Vector3) => {
  useStore.getState().checkpoint();
  drag3d = { key, id: item.id, dx: item.x / 1000 - at.x, dz: item.y / 1000 - at.z };
  useStore.getState().set({ dragging3d: true });
};
const Drag3d = () => {
  const { camera, gl } = useThree();
  useEffect(() => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ray = new THREE.Raycaster();
    const hit = new THREE.Vector3();
    const move = (e: PointerEvent) => {
      if (!drag3d) return;
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const g = Math.max(1, useStore.getState().gridMm);
      const d = drag3d;
      useStore.getState().updateLayout((l) => {
        const it = l.items.find((i) => i.id === d.id);
        if (!it) return;
        it.x = Math.round(((hit.x + d.dx) * 1000) / g) * g;
        it.y = Math.round(((hit.z + d.dz) * 1000) / g) * g;
      }, { commit: false, key: d.key });
    };
    const up = () => { if (drag3d) { drag3d = null; useStore.getState().set({ dragging3d: false }); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [camera, gl]);
  return null;
};

const SelectionBox = ({ item }: { item: Item }) => {
  const pts = useMemo(() => {
    const hw = item.w / 2000 + 0.03, hd = item.d / 2000 + 0.03;
    return [[-hw, 0.012, -hd], [hw, 0.012, -hd], [hw, 0.012, hd], [-hw, 0.012, hd], [-hw, 0.012, -hd]] as [number, number, number][];
  }, [item.w, item.d]);
  return <Line points={pts} color="#ff8a00" lineWidth={3} />;
};

/** Things overhead (ceiling fans, a patio roof) hide when looking down from above, like the ceilings. */
const OVERHEAD: Partial<Record<Item['kind'], 'all' | 'marked'>> = { 'ceiling-fan': 'all', patio: 'marked' };

const ItemMesh = ({ item, selected, layoutKey, base = 0, ceiling = 2400 }: { item: Item; selected: boolean; layoutKey: LayoutKey; base?: number; ceiling?: number }) => {
  const simple = useMemo(() => buildItem(item), [item.kind, item.w, item.d, item.h, item.color, JSON.stringify(item.ramp)]); // eslint-disable-line react-hooks/exhaustive-deps
  // the realistic model replaces the simple one once it has loaded
  const realistic = useStore((s) => s.realistic);
  const [real, setReal] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    setReal(null);
    if (!realistic || !hasRealModel(item.kind)) return;
    let live = true;
    realModel(item).then((o) => { if (live) setReal(o); });
    return () => { live = false; };
  }, [realistic, item.kind, item.w, item.d, item.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const obj = real ?? simple;
  const select = useStore((s) => s.set);
  const over = OVERHEAD[item.kind];
  const overhead = useMemo(() => {
    if (!over) return [];
    if (over === 'all') return [obj];
    const out: THREE.Object3D[] = [];
    obj.traverse((o) => { if (o.userData.overhead) out.push(o); });
    return out;
  }, [obj, over]);
  const topOf = (item.kind === 'patio' ? item.h : ceiling) / 1000;
  useFrame(({ camera }) => { if (overhead.length) { const v = camera.position.y < base / 1000 + topOf + 0.05; overhead.forEach((o) => { o.visible = v; }); } });
  // a ceiling fan hangs from the ceiling, whatever the ceiling height
  const elevation = item.kind === 'ceiling-fan' ? ceiling - item.h : item.elevation ?? 0;
  return (
    <group
      position={[item.x / 1000, base / 1000, item.y / 1000]}
      rotation-y={THREE.MathUtils.degToRad(-item.rotation)}
      onClick={(e) => { if (useStore.getState().tool !== 'select') return; e.stopPropagation(); select({ selection: { type: 'item', id: item.id } }); }}
      onPointerDown={(e) => {
        // drag furniture across the floor in 3D (the selected item only, so orbiting still works)
        const st = useStore.getState();
        if (st.tool !== 'select' || !selected || e.button !== 0) return;
        e.stopPropagation();
        startDrag3d(layoutKey, item, e.point);
      }}
    >
      <group position-y={elevation / 1000}>
        <primitive object={obj} />
      </group>
      {selected && <SelectionBox item={item} />}
    </group>
  );
};

const ImportedItem = ({ item, selected, settings }: { item: Item; selected: boolean; settings: ActivitySettings }) => {
  const assetVersion = useStore((s) => s.assetVersion);
  const asset = item.assetId ? ASSETS.get(item.assetId) : undefined;
  const select = useStore((s) => s.set);
  const { obj, mixer, action } = useMemo(() => {
    if (!asset) return { obj: null, mixer: null, action: null };
    const o = SkeletonUtils.clone(asset.scene);
    const mx = asset.clips.length ? new THREE.AnimationMixer(o) : null;
    const ac = mx ? mx.clipAction(asset.clips[0]) : null;
    ac?.play();
    return { obj: o, mixer: mx, action: ac };
  }, [asset, assetVersion]);
  const driven = settings.type === 'imported' && (settings.importedItemId ? settings.importedItemId === item.id : true);
  useFrame((state, dt) => {
    if (!mixer || !action) return;
    if (driven) mixer.setTime(useStore.getState().time);
    else { mixer.update(dt); state.invalidate(); }
  });
  const sc = item.modelScale ?? 1;
  return (
    <group
      position={[item.x / 1000, (item.elevation ?? 0) / 1000, item.y / 1000]}
      rotation-y={THREE.MathUtils.degToRad(-item.rotation)}
      onClick={(e) => { e.stopPropagation(); select({ selection: { type: 'item', id: item.id } }); }}
    >
      {obj && asset ? (
        <group scale={sc} position={[-asset.centre.x * sc, -asset.minY * sc, -asset.centre.z * sc]}>
          <primitive object={obj} />
        </group>
      ) : (
        <mesh position-y={item.h / 2000} castShadow>
          <boxGeometry args={[item.w / 1000, item.h / 1000, item.d / 1000]} />
          <meshStandardMaterial color="#c9c3e6" transparent opacity={0.6} />
          <Html center><div className="tag3d">Re-import “{item.label}”</div></Html>
        </mesh>
      )}
      {selected && <SelectionBox item={item} />}
    </group>
  );
};

const Items = ({ layout, settings, layoutKey }: { layout: Layout; settings: ActivitySettings; layoutKey: LayoutKey }) => {
  const sel = useStore((s) => s.selection);
  return (
    <>
      {layout.items.filter((it) => !it.hidden3d).map((it) =>
        it.kind === 'imported' ? (
          <ImportedItem key={it.id} item={it} selected={sel?.type === 'item' && sel.id === it.id} settings={settings} />
        ) : (
          <ItemMesh key={it.id} item={it} selected={sel?.type === 'item' && sel.id === it.id} layoutKey={layoutKey} base={floorAt(layout, it)} ceiling={layout.ceilingHeight} />
        ),
      )}
    </>
  );
};

// ---------------------------------------------------------------- people & equipment

const Actors = ({ built, settings, live, layout }: { built: BuiltActivity; settings: ActivitySettings; live: Live; layout: Layout }) => {
  const chair: ChairRig = useMemo(() => (settings.chair === 'manual' ? buildManualChair() : buildPowerChair()), [settings.chair]);
  const person = useMemo(() => buildAvatar(settings.persona), [settings.persona]);
  const helper = useMemo(() => buildAvatar(SUPPORT_PERSONA, 'support'), []);
  live.person = person;
  live.helper = built.helper ? helper : undefined;
  live.chair = chair.root;
  const q1 = useMemo(() => new THREE.Quaternion(), []);
  const q2 = useMemo(() => new THREE.Quaternion(), []);
  const X = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const Y = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const t = useStore.getState().time;
    const c = built.chair(t);
    const gc = groundAt(layout, c) / 1000;
    chair.root.position.set(c.x / 1000, gc, c.y / 1000);
    chair.root.rotation.y = THREE.MathUtils.degToRad(-c.heading);
    { const sp = chairOf(settings), base = CHAIRS[settings.chair]; chair.root.scale.set(sp.width / base.width, 1, sp.length / base.length); }
    for (const w of chair.wheels) w.obj.rotation.x = c.wheelTurn / 1000 / w.radius;
    const place = (rig: AvatarRig, s: ReturnType<BuiltActivity['person']>) => {
      rig.root.position.set(s.x / 1000, s.z / 1000 + groundAt(layout, s) / 1000, s.y / 1000);
      q1.setFromAxisAngle(Y, THREE.MathUtils.degToRad(-s.heading));
      q2.setFromAxisAngle(X, THREE.MathUtils.degToRad(s.pitch));
      rig.root.quaternion.copy(q1).multiply(q2);
      applyPose(rig, s.pose);
    };
    place(person, built.person(t));
    if (built.helper) place(helper, built.helper(t));
  });
  return (
    <>
      <primitive object={chair.root} />
      <primitive object={person.root} />
      {built.helper && <primitive object={helper.root} />}
    </>
  );
};

// cupboard doors (and similar) that open during an activity
const ActivityProps = ({ built }: { built: BuiltActivity }) => {
  const doors = useMemo(() => (built.props ?? []).map((p) => {
    const hinge = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(p.w / 1000, p.h / 1000, 0.018), new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.45 }));
    panel.position.set(p.w / 2000, p.elevation / 1000 + p.h / 2000, 0.009);
    panel.castShadow = true;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 0.9, roughness: 0.3 }));
    knob.position.set(p.w / 1000 - 0.04, p.elevation / 1000 + p.h / 1000 - 0.1, 0.035);
    hinge.add(panel, knob);
    // dark opening behind the door
    const cavity = new THREE.Mesh(new THREE.PlaneGeometry(p.w / 1000 - 0.02, p.h / 1000 - 0.02), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 1 }));
    const at = itemToPlan(p.item, { x: p.hingeX + p.w / 2, y: p.item.d / 2 + 2 });
    cavity.position.set(at.x / 1000, (p.elevation + p.h / 2) / 1000, at.y / 1000);
    cavity.rotation.y = THREE.MathUtils.degToRad(-p.item.rotation);
    const h = itemToPlan(p.item, { x: p.hingeX, y: p.item.d / 2 + 3 });
    const base = new THREE.Group();
    base.position.set(h.x / 1000, 0, h.y / 1000);
    base.rotation.y = THREE.MathUtils.degToRad(-p.item.rotation);
    base.add(hinge);
    return { p, hinge, base, cavity };
  }), [built]);
  useFrame(() => {
    const t = useStore.getState().time;
    for (const d of doors) {
      const a = d.p.angle(t);
      d.hinge.rotation.y = -THREE.MathUtils.degToRad(a); // free edge swings out towards the front
      d.cavity.visible = a > 1;
    }
  });
  return <>{doors.map((d, i) => <group key={i}><primitive object={d.base} /><primitive object={d.cavity} /></group>)}</>;
};

/** A soft red glow under the wheelchair while its outline overlaps a wall or furniture. */
const ChairOverlap = ({ route, width, length }: { route: NonNullable<BuiltActivity['route']>; width: number; length: number }) => {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = useStore.getState().time;
    const ss = route.samples;
    let lo = 0, hi = ss.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ss[mid].t <= t) lo = mid; else hi = mid - 1; }
    const s = ss[lo];
    m.visible = !!s?.hit;
    if (!s) return;
    m.position.set(s.x / 1000, 0.012, s.y / 1000);
    m.rotation.set(-Math.PI / 2, 0, -THREE.MathUtils.degToRad(s.heading));
  });
  return (
    <mesh ref={ref} visible={false}>
      <planeGeometry args={[width / 1000 + 0.12, length / 1000 + 0.12]} />
      <meshBasicMaterial color="#e53935" transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
};

const RouteOverlay = ({ built, settings }: { built: BuiltActivity; settings: ActivitySettings }) => {
  const route = built.route;
  const labels = useStore((s) => s.showLabels);
  // a contact's tag shows only around the moment the chair gets there (re-renders only when that changes)
  const nearKey = useStore((s) => (route?.contacts ?? []).map((c, i) => (Math.abs(s.time - c.t) < 2.5 ? i : -1)).filter((i) => i >= 0).join(','));
  const near = nearKey ? nearKey.split(',').map(Number) : [];
  const C = chairOf(settings);
  const line = useMemo(() => (route ? route.samples.filter((_, i) => i % 3 === 0).map((s) => [s.x / 1000, 0.015, s.y / 1000] as [number, number, number]) : []), [route]);
  const prints = useMemo(() => {
    if (!route || !settings.showSweptPath) return [];
    const out: { pts: [number, number, number][]; hit: boolean }[] = [];
    let last = -1e9;
    for (const s of route.samples) {
      if (s.dist - last < 220 && s !== route.samples[route.samples.length - 1]) continue;
      last = s.dist;
      const fp = chairFootprint(s, C.width, C.length);
      out.push({ pts: [...fp, fp[0]].map((p) => [p.x / 1000, 0.01, p.y / 1000]), hit: !!s.hit });
    }
    return out;
  }, [route, settings.showSweptPath, C.width, C.length]);
  if (!route || line.length < 2) return null;
  return (
    <group>
      <Line points={line} color="#1e88e5" lineWidth={3} dashed dashSize={0.12} gapSize={0.06} />
      {prints.map((p, i) => <Line key={i} points={p.pts} color={p.hit ? '#e53935' : '#1e88e5'} transparent opacity={p.hit ? 0.55 : 0.22} lineWidth={p.hit ? 2 : 1} />)}
      <ChairOverlap route={route} width={C.width} length={C.length} />
      {route.contacts.map((c, i) => (
        <group key={i} position={[c.at.x / 1000, 0.02, c.at.y / 1000]}>
          <mesh rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.22, 0.28, 40]} />
            <meshBasicMaterial color="#e53935" transparent opacity={0.85} />
          </mesh>
          {labels && near.includes(i) && (
            <Html center position={[0, 0.9, 0]} zIndexRange={[10, 0]}><div className="tag3d warn">Possible contact: {c.with}</div></Html>
          )}
        </group>
      ))}
    </group>
  );
};

const Pins = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const notes = useStore((s) => s.project.notes);
  const labels = useStore((s) => s.showLabels);
  return (
    <>
      {notes.filter((n) => n.pin && n.layout === layoutKey).map((n, i) => (
        <group key={n.id} position={P(n.pin!.x, n.pin!.y)}>
          <mesh position-y={1.6}>
            <sphereGeometry args={[0.07, 20, 16]} />
            <meshStandardMaterial color={n.category === 'concern' ? '#e53935' : '#7b1fa2'} emissive={n.category === 'concern' ? '#7a1010' : '#3a0e52'} />
          </mesh>
          <mesh position-y={0.8}>
            <cylinderGeometry args={[0.008, 0.008, 1.6]} />
            <meshBasicMaterial color="#555" />
          </mesh>
          <Html center position={[0, 1.8, 0]} zIndexRange={[10, 0]}><div className="tag3d">{labels ? <>{i + 1}. {n.text.slice(0, 40)}{n.text.length > 40 ? '…' : ''}</> : i + 1}</div></Html>
        </group>
      ))}
    </>
  );
};

// ---------------------------------------------------------------- camera

// The 3D views draw on demand: only when something changes (an edit, playback, the camera moving),
// not 60 times a second while nothing moves – which keeps a laptop cool and the rest of the app quick.
const wakers = new Set<() => void>();
const wake = () => wakers.forEach((f) => f());
const KeepFresh = () => {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    wakers.add(invalidate);
    const unsub = useStore.subscribe(() => invalidate());
    // a slow heartbeat catches anything that finishes loading in the background (textures, models)
    const beat = window.setInterval(() => invalidate(), 1000);
    return () => { wakers.delete(invalidate); unsub(); window.clearInterval(beat); };
  }, [invalidate]);
  return null;
};

// keys held for moving the 3D camera (W A S D / arrows, Q E turn, R F up/down, Shift faster)
const held = new Set<string>();
if (typeof window !== 'undefined') {
  const typing = (e: KeyboardEvent) => { const t = (e.target as HTMLElement)?.tagName; return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'; };
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const st = useStore.getState();
    // arrow keys move a selected wall/item instead; drawing tools keep the keyboard for lengths
    if (e.key.startsWith('Arrow') && st.selection) return;
    if (st.tool !== 'select' && st.tool !== 'move-plan') return;
    if (st.viewMode === 'plan') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      if (k === 'r' && st.selection) return; // R rotates a selected item
      held.add(k);
      wake();
      if (k.startsWith('Arrow')) e.preventDefault();
    }
    if (e.key === 'Shift') held.add('shift');
  });
  window.addEventListener('keyup', (e) => { held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); if (e.key === 'Shift') held.delete('shift'); });
  window.addEventListener('blur', () => held.clear());
}

/** Keep a camera on the near side of any wall between it and what it looks at. */
const ray = new THREE.Raycaster();
const keepInFront = (scene: THREE.Object3D, target: THREE.Vector3, eye: THREE.Vector3) => {
  const walls = scene.getObjectByName('walls');
  if (!walls) return eye;
  const dir = eye.clone().sub(target);
  const len = dir.length();
  if (len < 0.05) return eye;
  ray.set(target, dir.divideScalar(len));
  ray.far = len;
  const hit = ray.intersectObject(walls, true).find((h) => (h.object as THREE.Mesh).visible && h.object.parent?.visible !== false);
  if (!hit) return eye;
  if (hit.distance > 1.1) return target.clone().addScaledVector(ray.ray.direction, hit.distance - 0.15);
  // too cramped behind (e.g. in a doorway): look down from above and just behind instead
  const back = ray.ray.direction.clone().setY(0);
  if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
  return target.clone().addScaledVector(back.normalize(), 0.5).add(new THREE.Vector3(0, 1.9, 0));
};

const CameraRig = ({ layout, built, live }: { layout: Layout; built: BuiltActivity; live: Live }) => {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, scene } = useThree();
  const preset = useStore((s) => s.camera);
  const nonce = useStore((s) => s.cameraNonce);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; k: number } | null>(null);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  const lastPerson = useRef<THREE.Vector3 | null>(null);
  const follow = preset === 'seated' || preset === 'support' || preset === 'follow';

  const b = layoutBounds({ ...layout, items: [] });
  const centre = new THREE.Vector3((b.minX + b.maxX) / 2000, 0.5, (b.minY + b.maxY) / 2000);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 1000;

  useEffect(() => {
    lastPerson.current = null;
    if (follow || preset === 'free') { anim.current = null; return; }
    let pos: THREE.Vector3, target: THREE.Vector3;
    if (preset === 'top') {
      target = centre.clone().setY(0);
      pos = centre.clone().add(new THREE.Vector3(0, size * 1.55 + 2.5, 0.01));
    } else if (preset === 'closeup') {
      // start near the person now; the view then follows them (and can still be orbited)
      const p = built.person(useStore.getState().time);
      target = P(p.x, p.y, 650);
      const toC = new THREE.Vector3(centre.x - p.x / 1000, 0, centre.z - p.y / 1000);
      if (toC.length() < 0.3) toC.set(1, 0, 1);
      toC.normalize();
      pos = target.clone().addScaledVector(toC, 2.4).setY(2.0);
    } else {
      target = centre.clone();
      pos = centre.clone().add(new THREE.Vector3(-size * 0.35, size * 0.85 + 2.2, size * 0.75 + 1.8));
    }
    const ctl = controls.current;
    anim.current = { from: camera.position.clone(), to: pos, tFrom: ctl ? ctl.target.clone() : target.clone(), tTo: target, k: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, nonce, size, centre.x, centre.z]);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = preset === 'seated' || preset === 'support' ? 68 : 50;
    cam.updateProjectionMatrix();
  }, [preset, camera]);

  useFrame((state, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    if (held.size || anim.current) state.invalidate();
    // keyboard movement: switches to "Walk around" and moves the camera and what it looks at together
    if (held.size && !(held.size === 1 && held.has('shift'))) {
      if (useStore.getState().camera !== 'free') { anim.current = null; useStore.setState({ camera: 'free' }); }
      // faster when looking at the whole house from far away
      const reach = Math.max(1, camera.position.distanceTo(ctl.target));
      const speed = Math.max(2.2, reach * 0.7) * (held.has('shift') ? 2.5 : 1) * Math.min(dt, 0.05);
      const fwd = tmp.a.subVectors(ctl.target, camera.position).setY(0);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = tmp.b.set(-fwd.z, 0, fwd.x);
      const mv = tmp.c.set(0, 0, 0);
      if (held.has('w') || held.has('ArrowUp')) mv.add(fwd);
      if (held.has('s') || held.has('ArrowDown')) mv.sub(fwd);
      if (held.has('d') || held.has('ArrowRight')) mv.add(right);
      if (held.has('a') || held.has('ArrowLeft')) mv.sub(right);
      if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed);
      if (held.has('r')) mv.y += speed;
      if (held.has('f')) mv.y -= speed;
      camera.position.add(mv);
      ctl.target.add(mv);
      if (camera.position.y < 0.3) { const d = 0.3 - camera.position.y; camera.position.y += d; ctl.target.y += d; }
      const turn = ((held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0)) * 1.3 * Math.min(dt, 0.05);
      if (turn) {
        // turn on the spot: swing what we look at around the camera
        const v = tmp.d.subVectors(ctl.target, camera.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn);
        ctl.target.copy(camera.position).add(v);
      }
      ctl.update();
      return;
    }
    ctl.enabled = !follow && !useStore.getState().dragging3d;
    if (anim.current) {
      const a = anim.current;
      a.k = Math.min(1, a.k + dt / 0.9);
      const u = a.k * a.k * (3 - 2 * a.k);
      camera.position.lerpVectors(a.from, a.to, u);
      ctl.target.lerpVectors(a.tFrom, a.tTo, u);
      if (a.k >= 1) anim.current = null;
      ctl.update();
      return;
    }
    const t = useStore.getState().time;
    if (preset === 'closeup') {
      // carry the view along with the person, keeping whatever angle the user has orbited to
      const p = built.person(t);
      const now = P(p.x, p.y, 650);
      if (lastPerson.current) {
        const d = tmp.a.subVectors(now, lastPerson.current);
        camera.position.add(d);
        ctl.target.add(d);
        ctl.update();
      }
      lastPerson.current = now.clone();
      return;
    }
    if (!follow) return;
    const smooth = 1 - Math.pow(0.0005, dt);
    if (preset === 'seated' && live.person) {
      const head = live.person.head;
      head.updateWorldMatrix(true, false);
      const hp = head.localToWorld(tmp.a.set(0, 0.11, 0.11));
      const fwd = tmp.b.set(0, 0, 1).transformDirection(head.matrixWorld);
      fwd.y = Math.min(fwd.y, 0.1) - 0.18;
      camera.position.lerp(hp, smooth);
      ctl.target.lerp(tmp.c.copy(hp).addScaledVector(fwd.normalize(), 2), smooth);
    } else if (preset === 'support') {
      const p = built.person(t);
      const look = P(p.x, p.y, p.z + 100);
      let eye: THREE.Vector3;
      if (live.helper) {
        // just behind and above the carer's head, so her own body doesn't fill the view
        live.helper.head.updateWorldMatrix(true, false);
        const h = live.helper.head.getWorldPosition(tmp.a);
        const away = tmp.b.subVectors(h, look).setY(0);
        if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
        away.normalize();
        eye = h.clone().addScaledVector(away, 0.45).add(new THREE.Vector3(0, 0.15, 0));
      } else {
        const c = built.chair(t);
        const off = rotate({ x: -900, y: -1100 }, c.heading);
        eye = P(c.x + off.x, c.y + off.y, 1600);
      }
      camera.position.lerp(keepInFront(scene, look, eye), smooth);
      ctl.target.lerp(look, smooth);
    } else if (preset === 'follow') {
      const c = built.chair(t);
      const back = rotate({ x: 0, y: -2300 }, c.heading);
      const p = built.person(t);
      const look = P(p.x, p.y, 700);
      camera.position.lerp(keepInFront(scene, look, P(c.x + back.x, c.y + back.y, 1750)), smooth);
      ctl.target.lerp(look, smooth);
    }
    camera.lookAt(ctl.target);
  });

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={0.4} maxDistance={30} />;
};

// ---------------------------------------------------------------- canvas

const SceneContents = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const layout = useStore((s) => s.project.layouts[layoutKey]);
  const settings = useStore((s) => s.project.activity);
  const hq = useStore((s) => s.highQuality);
  const built = useActivity(layoutKey);
  const live = useMemo<Live>(() => ({}), []);
  return (
    <>
      <EnvironmentSetup />
      <Lights layout={layout} hq={hq} />
      <group onClick={(e) => {
        // the Place tool works in 3D too: click the floor (or a wall) where it should go
        const st = useStore.getState();
        if (st.tool !== 'place') return;
        e.stopPropagation();
        if (st.activeLayout !== layoutKey) st.set({ activeLayout: layoutKey });
        placeAt(layoutKey, { x: e.point.x * 1000, y: e.point.z * 1000 });
      }}>
        <Floor layout={layout} />
        <RoomFinishes layout={layout} />
        <Walls layout={layout} />
        <Items layout={layout} settings={settings} layoutKey={layoutKey} />
      </group>
      <FloorGrid layout={layout} />
      <ClearanceRings layoutKey={layoutKey} />
      <SelectionDims layout={layout} />
      {settings.type === 'original' && <OriginalActors built={built} live={live as never} />}
      {settings.type !== 'imported' && settings.type !== 'original' && (built.mh
        ? <PersonaActors built={built} settings={settings} live={live} layout={layout} />
        : <Actors built={built} settings={settings} live={live} layout={layout} />)}
      {built.props && <ActivityProps built={built} />}
      {settings.type !== 'imported' && settings.type !== 'original' && <RouteOverlay built={built} settings={settings} />}
      <Pins layoutKey={layoutKey} />
      <Drag3d />
      <CameraRig layout={layout} built={built} live={live} />
      {hq && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <N8AO aoRadius={0.45} intensity={2.2} distanceFalloff={0.6} halfRes quality="medium" />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
};

/** While Persona 2's body and recording download (about 10 MB). */
const PersonaLoading = () => {
  const want = useStore((s) => s.project.activity.character === 'p2');
  useStore((s) => s.assetVersion);
  if (!want || getOriginal(P2_ID) || originalMissing(P2_ID)) return null;
  return <div className="persona-loading" role="status">Loading Persona 2…</div>;
};

export const Scene3D = ({ layoutKey, label }: { layoutKey: LayoutKey; label?: string }) => {
  const hq = useStore((s) => s.highQuality);
  const clear = useStore((s) => s.set);
  return (
    <div className="scene3d">
      <Canvas
        frameloop="demand"
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={hq ? [1, 2] : [1, 1.25]}
        gl={{ antialias: !hq, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, preserveDrawingBuffer: true }}
        camera={{ fov: 50, near: 0.05, far: 100, position: [-3, 6, 8] }}
        onPointerMissed={() => clear({ selection: null })}
      >
        <KeepFresh />
        <Suspense fallback={null}>
          <SceneContents layoutKey={layoutKey} />
        </Suspense>
      </Canvas>
      {label && <div className={`scene-label ${layoutKey}`}>{label}</div>}
      <PersonaLoading />
    </div>
  );
};
