import { CHAIRS } from '../model/catalogue';
import { add, clearOpening, dist, headingOf, itemToPlan, rotate, wallPoint } from '../model/geometry';
import { chairFootprint, obstaclesOf, planRoute, sampleAt, type RouteResult } from '../model/pathfinding';
import { fitPoint, fitToBed, fitWeight, getOriginal, sampleTrack, toPlan, ueYaw, type BedFit, type OriginalSceneData } from '../originals/originals';
import { polygonsOverlap } from '../model/geometry';
import type { ActivitySettings, ActivityType, Item, Layout, Vec2 } from '../model/types';
import {
  ASSIST, HOLD_ITEM_R, LONG_SIT, LYING, OPEN_SWING_R, POWER_DRIVE, PUSH_HANDLES, REACH_FORWARD, REACH_IN, REACH_LOW_R, SEATED, SEATED_REST, STANDING,
  TRANSFER_MID_R, TRANSFER_PREP_R, fullPose, lerpPose, mirrorPose, pushPose, walkPose, type Pose,
} from './poses';

export const ACTIVITY_INFO: Record<ActivityType, { label: string; needs?: string[]; blurb: string }> = {
  navigate: { label: 'Move around the room', blurb: 'From S to E – drag the markers on the plan.' },
  'bed-transfer': { label: 'Bed transfer', needs: ['bed-queen', 'bed-single', 'bed-adjustable'], blurb: '' },
  'toilet-transfer': { label: 'Toilet transfer', needs: ['toilet'], blurb: '' },
  basin: { label: 'Use the basin', needs: ['basin', 'vanity', 'kitchen-bench'], blurb: '' },
  cupboard: { label: 'Open a cupboard', needs: ['kitchen-bench', 'tv-unit', 'drawers', 'wardrobe'], blurb: '' },
  'chair-transfer': { label: 'Move onto a chair or sofa', needs: ['armchair', 'sofa', 'dining-chair'], blurb: '' },
  imported: { label: 'Imported animation', blurb: '' },
  original: { label: 'Original VisADLs recording', blurb: '' },
};

export interface BodyState {
  x: number; y: number; // plan mm (pelvis)
  z: number; // height of pelvis above floor, mm
  heading: number; // plan degrees
  pitch: number; // degrees; -90 = lying on back
  pose: Required<Pose>;
}

export interface ChairState { x: number; y: number; heading: number; /** distance travelled (mm) – drives wheel rotation */ wheelTurn: number; moving: boolean }

export interface Phase { t: number; label: string }

/** A plan frame: position (mm) and heading (degrees, plan). */
export interface Frame2 { x: number; y: number; h: number }
/** Maps a recording's plan space onto the current layout: `from` (recording) lands on `to`. */
export interface Anchor { from: Frame2; to: Frame2; lift: number; mirror: boolean }
/** A body is either posed from a recording (at time `tau`, re-anchored) or by the app's poses. */
export type Src = { kind: 'clip'; tau: number; anchor: Anchor } | { kind: 'pose' };
/** `a`, optionally blended towards `b` by `w` (0 = all a). */
export interface Mix { a: Src; b?: Src; w: number }

/** A cupboard door (or similar) that moves during an activity. */
export interface ActivityProp { item: Item; hingeX: number; w: number; h: number; elevation: number; angle: (t: number) => number }

export const P2_ID = 'p2-bed-transfer';

export interface BuiltActivity {
  type: ActivityType;
  duration: number;
  route?: RouteResult;
  phases: Phase[];
  chair: (t: number) => ChairState;
  person: (t: number) => BodyState;
  helper?: (t: number) => BodyState;
  /** chair parking spot used for the activity, for the plan view */
  parking?: { x: number; y: number; heading: number };
  target?: Item;
  problem?: string;
  /** which side the chair parks on (after 'auto' has been resolved) */
  side?: 'left' | 'right';
  /** original recordings: how the transfer is fitted to the bed in this layout */
  bedFit?: BedFit;
  /** Persona 2 (MetaHuman): where each body's movement comes from over time */
  mh?: { person: (t: number) => Mix; carer?: (t: number) => Mix; hoist?: (t: number) => Mix; mirrored?: boolean; recorded?: boolean };
  /** things that move during the activity (cupboard doors) */
  props?: ActivityProp[];
  /** where the chair is too wide for the space (e.g. a doorway) – shown, but it still carries on */
  narrow?: { at: Vec2; t: number; where: string };
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const angleLerp = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;

const PELVIS_BACK = 110; // pelvis sits this far behind the chair centre (mm)
const SEAT_PELVIS = 95; // pelvis (hip joint) height above the seat surface (mm)

const chairSeatTop = (chair: ActivitySettings['chair']) => CHAIRS[chair].seatHeight;

const personInChair = (c: { x: number; y: number; heading: number }, chair: ActivitySettings['chair'], pose: Required<Pose>, scale: number, seatOff = SEAT_PELVIS * scale): BodyState => {
  const p = add(c, rotate({ x: 0, y: -PELVIS_BACK }, c.heading));
  return { x: p.x, y: p.y, z: chairSeatTop(chair) + seatOff, heading: c.heading, pitch: 0, pose };
};

interface Key { t: number; s: Omit<BodyState, 'pose'> & { pose: Pose }; arc?: number }

const keyTrack = (keys: Key[]) => (t: number): BodyState => {
  if (t <= keys[0].t) return { ...keys[0].s, pose: fullPose(keys[0].s.pose) };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const u = ease((t - a.t) / (b.t - a.t || 1));
      return {
        x: a.s.x + (b.s.x - a.s.x) * u,
        y: a.s.y + (b.s.y - a.s.y) * u,
        z: a.s.z + (b.s.z - a.s.z) * u + (b.arc ?? 0) * Math.sin(Math.PI * u),
        heading: angleLerp(a.s.heading, b.s.heading, u),
        pitch: a.s.pitch + (b.s.pitch - a.s.pitch) * u,
        pose: lerpPose(a.s.pose, b.s.pose, u),
      };
    }
  }
  const l = keys[keys.length - 1];
  return { ...l.s, pose: fullPose(l.s.pose) };
};

/** The app's chair placement that follows the recorded wheelchair (plan mm), at recording time t. */
export const recordedChair = (sc: OriginalSceneData) => {
  const chairTrack = sc.props.find((p) => p.builtin)?.track;
  const travelled: number[] = [];
  let dist = 0;
  let last: { x: number; y: number } | null = null;
  if (chairTrack) {
    for (let f = 0; f < chairTrack.frames; f++) {
      const p = toPlan(sc, chairTrack.data[f * 7], chairTrack.data[f * 7 + 1]);
      if (last) dist += Math.hypot(p.x - last.x, p.y - last.y);
      travelled.push(dist);
      last = p;
    }
  }
  return (t: number): ChairState => {
    if (!chairTrack) return { x: 0, y: 0, heading: 0, wheelTurn: 0, moving: false };
    const s = sampleTrack(chairTrack, t);
    const yaw = ueYaw(s.slice(3));
    const fwd = { x: Math.cos((yaw * Math.PI) / 180), y: Math.sin((yaw * Math.PI) / 180) };
    // the original chair's pivot sits ~10 cm behind the seat centre
    const p = toPlan(sc, s[0] - fwd.x * 10, s[1] - fwd.y * 10);
    const fi = Math.min(travelled.length - 1, Math.round(t * chairTrack.fps));
    const moving = fi > 0 && Math.abs(travelled[fi] - travelled[Math.max(0, fi - 1)]) > 1;
    return { x: p.x, y: p.y, heading: headingOf(fwd), wheelTurn: travelled[fi] ?? 0, moving };
  };
};

/** Plain description of where a chair got stuck: the nearest doorway, else "a wall". */
const describeStop = (layout: Layout, at: Vec2) => {
  let best: { d: number; text: string } | null = null;
  for (const o of layout.openings) {
    if (o.kind === 'window') continue;
    const w = layout.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const d = dist(wallPoint(w, o.offset), at);
    const name = o.kind === 'opening' ? 'opening' : o.kind === 'sliding-door' ? 'sliding door' : 'door';
    if (d < 1200 && (!best || d < best.d)) best = { d, text: `the ${o.width} mm ${name} (about ${clearOpening(o)} mm clear)` };
  }
  return best?.text ?? 'a wall';
};

const toLocal = (F: Frame2, p: Frame2): Frame2 => ({ ...rotate({ x: p.x - F.x, y: p.y - F.y }, -F.h), h: p.h - F.h });
const toWorld = (F: Frame2, r: Frame2): Frame2 => ({ ...add(F, rotate(r, F.h)), h: r.h + F.h });
const frameOf = (c: { x: number; y: number; heading: number }): Frame2 => ({ x: c.x, y: c.y, h: c.heading });

// Persona 2's recording: seated idle movement used while she drives, and the hoist transfer.
// her own driving (upright, hand on the joystick); 32–48 s and 78–94 s she leans forward ~20–30°
const SEAT_LOOP: [number, number] = [6, 28];
const HOIST_FROM = 150, HOIST_LIFT = 158, HOIST_DOWN = 188, HOIST_TO = 215;
const loopTau = (t: number) => {
  const [a, b] = SEAT_LOOP, L = b - a;
  const u = ((t % (2 * L)) + 2 * L) % (2 * L);
  return a + (u < L ? u : 2 * L - u); // ping-pong, so the loop has no jump
};

const findTarget = (layout: Layout, kinds: string[]): Item | undefined => {
  const preferred = layout.items.find((i) => i.id === layout.targetItemId && kinds.includes(i.kind));
  // otherwise the first kind in the activity's list that the layout has (e.g. kitchen bench before wardrobe)
  for (const k of kinds) { const it = preferred ?? layout.items.find((i) => i.kind === k); if (it) return it; }
  return undefined;
};

/** Build the full timeline for the chosen activity in a layout. */
export const buildActivity = (layout: Layout, settings: ActivitySettings, importedDuration = 0): BuiltActivity => {
  const b = buildActivityInner(layout, settings, importedDuration);
  const n = b.route?.narrow;
  return n ? { ...b, narrow: { ...n, where: describeStop(layout, n.at) } } : b;
};

const buildActivityInner = (layout: Layout, settings: ActivitySettings, importedDuration = 0): BuiltActivity => {
  const C = CHAIRS[settings.chair];
  const scale = settings.persona.heightCm / 175;
  const manual = settings.chair === 'manual';
  let s = settings.transferSide === 'left' ? -1 : 1;
  const type = settings.type;
  // Persona 2 (the original VisADLs MetaHuman): her recording is used where it fits
  const rec = settings.character === 'p2' ? getOriginal(P2_ID) : undefined;
  const p2 = !!rec;
  const sitOff = p2 ? 20 : 95 * scale; // hip joints above the seat surface (mm)
  const lieOff = p2 ? 95 : 110 * scale;
  const hoist = p2 && type === 'bed-transfer' && settings.bedMethod !== 'side' && !!rec?.scene.bedFit;

  const drivePose = (d: number, moving: boolean) => (manual ? (moving ? pushPose((d / 650) % 1) : fullPose(SEATED)) : fullPose(POWER_DRIVE));

  if (type === 'original') {
    const o = getOriginal(settings.originalId);
    if (!o) {
      const still = { x: layout.start.x, y: layout.start.y, heading: layout.start.heading };
      return {
        type, duration: 1, phases: [{ t: 0, label: 'Loading recording…' }], problem: 'The original recording is still loading (or is not part of this copy of the app).',
        chair: () => ({ ...still, wheelTurn: 0, moving: false }),
        person: () => personInChair(still, settings.chair, fullPose(SEATED), scale),
      };
    }
    const sc = o.scene;
    const chairAt = recordedChair(sc);
    // the recording's bed is replaced by the bed in this layout; the transfer is bent to land on it
    const bed = layout.items.find((i) => i.id === layout.targetItemId && i.kind.startsWith('bed'))
      ?? layout.items.find((i) => i.kind.startsWith('bed') && i.kind !== 'bedside-table');
    const bedFit = bed ? fitToBed(sc, bed) : undefined;
    const person = (t: number): BodyState => {
      const s = sampleTrack(sc.person.track, t);
      const w = fitWeight(bedFit, t);
      const p = fitPoint(bedFit, w, toPlan(sc, s[0], s[1]));
      const c = chairAt(t);
      return { x: p.x, y: p.y, z: s[2] * 10 + (bedFit ? bedFit.lift * w : 0), heading: c.heading, pitch: 0, pose: fullPose(SEATED) };
    };
    return {
      type, duration: sc.duration, phases: sc.phases, chair: chairAt, person, bedFit, target: bed,
      problem: bed ? undefined : 'There is no bed in this room, so the transfer has nowhere to land. Add a bed from the furniture list.',
    };
  }

  if (type === 'imported') {
    const still = { x: layout.start.x, y: layout.start.y, heading: layout.start.heading };
    return {
      type, duration: Math.max(1, importedDuration), phases: [{ t: 0, label: 'Imported animation' }],
      chair: () => ({ ...still, wheelTurn: 0, moving: false }),
      person: () => personInChair(still, settings.chair, fullPose(SEATED), scale),
    };
  }

  // --- work out the goal and what happens there ---
  let target: Item | undefined;
  let goal: Vec2 & { heading?: number } = layout.end;
  let problem: string | undefined;
  const info = ACTIVITY_INFO[type];
  if (info.needs) {
    target = findTarget(layout, info.needs);
    if (!target) problem = `This layout has no ${info.needs[0].split('-')[0]} – add one from the furniture list to try this activity.`;
  }

  // where you sit on a seat-type target (item-local mm) and the seat height
  const seatOf = (it: Item, sd: number) => {
    if (it.kind === 'toilet') return { x: 0, y: -it.d / 2 + 450, h: 460 };
    if (it.kind === 'sofa') return { x: sd * (it.w / 2 - 180 - (it.w - 360) / 6), y: 60, h: 450 };
    if (it.kind === 'dining-chair') return { x: 0, y: 20, h: 475 };
    return { x: 0, y: 40, h: 470 }; // armchair
  };

  // Persona 2's hoist transfer: the chair parks beside the bed exactly as in the recording
  // (mirrored when it parks on the other side); she lies `inset` in from the edge on that side.
  const recChair = rec ? recordedChair(rec.scene) : undefined;
  const hoistFrames = (sd: number) => {
    if (!hoist || !rec || !target || !recChair) return null;
    const f = rec.scene.bedFit!;
    const F0: Frame2 = { ...toPlan(rec.scene, f.lateralX, f.headEndY), h: f.rotation };
    const rel = toLocal(F0, frameOf(recChair(HOIST_FROM)));
    const recSide = rel.x >= 0 ? 1 : -1;
    const mirror = sd !== recSide;
    const inset = 450;
    const F1: Frame2 = { ...itemToPlan(target, { x: sd * Math.max(0, target.w / 2 - inset), y: -target.d / 2 }), h: target.rotation };
    const park = toWorld(F1, mirror ? { x: -rel.x, y: rel.y, h: -rel.h } : rel);
    return { F0, F1, mirror, park, recSide };
  };

  // chair parking pose for each activity (plan coordinates), for side `sd` (+1 = right as you face the item)
  const parkingFor = (sd: number): (Vec2 & { heading?: number }) | null => {
    if (!target) return null;
    if (hoist) {
      const hf = hoistFrames(sd);
      return hf ? { x: hf.park.x, y: hf.park.y, heading: hf.park.h } : null;
    }
    if (type === 'chair-transfer') {
      const seat = seatOf(target, sd);
      // pelvis level with the seat, but the chair's back no further back than the seat's back
      const y = Math.max(seat.y + PELVIS_BACK, -target.d / 2 + C.length / 2 + 30);
      return { ...itemToPlan(target, { x: sd * (target.w / 2 + C.width / 2 + 100), y }), heading: target.rotation };
    }
    if (type === 'cupboard') {
      return { ...itemToPlan(target, { x: 0, y: target.d / 2 + C.length / 2 + 180 }), heading: target.rotation + 180 };
    }
    if (type === 'bed-transfer') {
      const ang = 10;
      const dLocal = rotate({ x: 0, y: -1 }, sd * ang); // facing the bed head, angled in toward the bed
      const heading = headingOf(rotate(dLocal, target.rotation));
      // keep the angled chair's rear corner clear of the mattress edge
      const angleGap = Math.sin((ang * Math.PI) / 180) * (C.length / 2);
      return { ...itemToPlan(target, { x: sd * (target.w / 2 + C.width / 2 + 60 + angleGap), y: 250 }), heading };
    }
    if (type === 'toilet-transfer') {
      // chair alongside the pan, facing the same way as the toilet, pelvis level with the seat
      const seatY = -target.d / 2 + 450;
      return { ...itemToPlan(target, { x: sd * (target.w / 2 + C.width / 2 + 100), y: Math.max(seatY + PELVIS_BACK, -target.d / 2 + C.length / 2 + 30) }), heading: target.rotation };
    }
    if (type === 'basin') {
      const under = target.kind === 'basin' ? 230 : 0;
      return { ...itemToPlan(target, { x: 0, y: target.d / 2 + C.length / 2 - under + 40 }), heading: target.rotation + 180 };
    }
    return null;
  };
  const blockedAt = (g: Vec2 & { heading?: number }) => {
    const fp = chairFootprint({ x: g.x, y: g.y, heading: g.heading ?? 0 }, C.width, C.length);
    return obstaclesOf(layout).filter((o) => polygonsOverlap(fp, o.poly)).map((o) => o.label);
  };
  const approach = hoist ? -900 : type === 'basin' || type === 'cupboard' ? 700 : type === 'bed-transfer' ? 1000 : type === 'toilet-transfer' || type === 'chair-transfer' ? -750 : 0;
  const routeTo = (g: Vec2 & { heading?: number }) => planRoute(layout, {
    start: layout.start,
    goal: g,
    chairWidth: C.width,
    chairLength: C.length,
    // straight final approach (mm); negative = the chair reverses into the spot
    approach,
    speed: manual ? 700 : 800,
  });
  let route: RouteResult | undefined;
  if (target && (type === 'bed-transfer' || type === 'toilet-transfer' || type === 'chair-transfer')) {
    if (settings.transferSide === 'auto') {
      // the side whose parking spot is free and can be reached; the recorded side when both work
      const pref = hoist ? (hoistFrames(1)?.recSide ?? 1) : 1;
      const rank = { clear: 0, tight: 1, blocked: 2 } as const;
      const score = (sd: number) => {
        const g = parkingFor(sd)!;
        const r = routeTo(g);
        return { r, v: blockedAt(g).length * 10 + rank[r.status] };
      };
      const A = score(pref), B = score(-pref);
      s = B.v < A.v ? -pref : pref;
      route = B.v < A.v ? B.r : A.r;
    }
    const hits = blockedAt(parkingFor(s)!);
    if (hits.length) problem = `On this side the wheelchair overlaps the ${[...new Set(hits)].join(' and ')} where it parks. Try the other side, or move things to make room.`;
  }
  const park = parkingFor(s);
  if (park) goal = park;
  route ??= routeTo(goal);

  const T0 = route.duration;
  const chairAt = (t: number): ChairState => {
    const p = sampleAt(route.samples, t);
    return { x: p.x, y: p.y, heading: p.heading, wheelTurn: p.dist, moving: t > 0 && t < T0 };
  };
  const parked = chairAt(T0);
  const phases: Phase[] = [{ t: 0, label: 'Approach' }];

  // support person follows behind during travel
  const helperFollow = (t: number): BodyState => {
    const c = chairAt(t);
    const back = add(c, rotate({ x: 0, y: -(C.length / 2 + 330) }, c.heading));
    const moving = t > 0 && t < T0;
    const pose = manual ? (moving ? walkPose((sampleAt(route.samples, t).dist / 1300) % 1, PUSH_HANDLES) : fullPose(PUSH_HANDLES)) : moving ? walkPose((sampleAt(route.samples, t).dist / 1300) % 1) : fullPose(STANDING);
    return { x: back.x, y: back.y, z: 960 * 1, heading: c.heading, pitch: 0, pose };
  };

  const personTravel = (t: number) => {
    const c = chairAt(t);
    return personInChair(c, settings.chair, drivePose(sampleAt(route.samples, t).dist, c.moving), scale, sitOff);
  };

  // Persona 2 while driving: her recorded seated movement, carried by the app's chair
  const seatedLoop = (t: number, mirror = false): Src => {
    const tau = loopTau(t);
    return { kind: 'clip', tau, anchor: { from: frameOf(recChair!(tau)), to: frameOf(chairAt(Math.min(t, T0))), lift: 0, mirror } };
  };
  // ... then easing into the app's poses for the activity itself
  const p2Mix = (t: number): Mix => (t < T0 ? { a: seatedLoop(t), w: 0 } : { a: seatedLoop(T0), b: { kind: 'pose' }, w: ease((t - T0) / 0.8) });

  if (!target || type === 'navigate') {
    const duration = T0 + 1.5;
    return {
      type, duration, route, phases, target, problem,
      chair: chairAt, person: personTravel, helper: settings.supportPerson ? helperFollow : undefined,
      mh: p2 ? { person: (t) => ({ a: seatedLoop(t), w: 0 }), carer: settings.supportPerson ? () => ({ a: { kind: 'pose' }, w: 0 }) : undefined } : undefined,
    };
  }

  // ---- Persona 2's recorded hoist transfer, fitted to this bed
  if (hoist && target && rec) {
    const hf = hoistFrames(s)!;
    const f = rec.scene.bedFit!;
    const lift = target.h - f.topCm * 10;
    const tB = T0 + 1;
    // the quiet parts of the recording play faster (and the timeline says so): getting ready ×2,
    // the lift itself at real speed, settling on the bed ×3
    const R1 = 2, R3 = 3;
    const d1 = (HOIST_LIFT - HOIST_FROM) / R1, d2 = HOIST_DOWN - HOIST_LIFT, d3 = (HOIST_TO - HOIST_DOWN) / R3;
    const tau = (t: number) => {
      const u = t - tB;
      if (u <= 0) return HOIST_FROM;
      if (u < d1) return HOIST_FROM + u * R1;
      if (u < d1 + d2) return HOIST_LIFT + (u - d1);
      return Math.min(HOIST_TO, HOIST_DOWN + (u - d1 - d2) * R3);
    };
    const liftAt = (tau: number) => lift * ease((tau - HOIST_LIFT) / (HOIST_DOWN - HOIST_LIFT));
    const bedAnchor = (tau: number, withLift: boolean): Anchor => ({ from: hf.F0, to: hf.F1, lift: withLift ? liftAt(tau) : 0, mirror: hf.mirror });
    const clip = (t: number): Src => ({ kind: 'clip', tau: tau(t), anchor: bedAnchor(tau(t), true) });
    const person = (t: number): BodyState => {
      // rough body position for the plan view and cameras (the 3D view uses the recording itself)
      if (t < tB) return personTravel(t);
      const tr = sampleTrack(rec.scene.person.track, tau(t));
      const l = toLocal(hf.F0, { ...toPlan(rec.scene, tr[0], tr[1]), h: 0 });
      const w = toWorld(hf.F1, { x: hf.mirror ? -l.x : l.x, y: l.y, h: 0 });
      return { ...personTravel(T0), x: w.x, y: w.y, z: (tr[2] - (rec.scene.floorZ ?? 0)) * 10 + liftAt(tau(t)) };
    };
    const phases2: Phase[] = [
      { t: 0, label: 'Drive' },
      { t: T0, label: 'Ready' },
      { t: tB + d1, label: 'Hoist' },
      { t: tB + d1 + d2, label: 'On bed' },
    ];
    return {
      type, duration: tB + d1 + d2 + d3 + 2, route, phases: phases2, target, problem, side: s > 0 ? 'right' : 'left',
      parking: { x: parked.x, y: parked.y, heading: parked.heading },
      chair: (t) => (t < T0 ? chairAt(t) : { ...parked, moving: false }),
      person,
      mh: {
        person: (t) => (t < T0 ? { a: seatedLoop(t, hf.mirror), w: 0 } : { a: seatedLoop(T0, hf.mirror), b: clip(t), w: ease((t - T0) / (tB - T0)) }),
        carer: (t) => ({ a: { kind: 'clip', tau: tau(t), anchor: bedAnchor(tau(t), false) }, w: 0 }),
        hoist: (t) => ({ a: clip(t), w: 0 }),
        mirrored: hf.mirror,
        recorded: true,
      },
    };
  }

  const prep = personInChair(parked, settings.chair, fullPose(SEATED), scale, sitOff);
  // Which hand leads (the one nearest the target): beside the bed the chair faces the bed head,
  // so the bed is on the avatar's right when s < 0; beside the toilet the chair faces the same way
  // as the toilet, so the toilet is on the right when s > 0.
  const leadRight = type === 'toilet-transfer' ? s > 0 : s < 0;
  const prepPose = leadRight ? TRANSFER_PREP_R : mirrorPose(TRANSFER_PREP_R);
  const midPose = leadRight ? TRANSFER_MID_R : mirrorPose(TRANSFER_MID_R);

  let keys: Key[] = [];
  let tEnd = T0;
  let props: ActivityProp[] | undefined;
  const k = (t: number, st: Partial<Omit<BodyState, 'pose'>> & { pose: Pose }, arc?: number): Key => ({ t, s: { ...prep, ...st, pose: st.pose as Pose }, arc });

  if (type === 'bed-transfer' && target) {
    const edge = itemToPlan(target, { x: s * (target.w / 2 - 260), y: 120 });
    const sit = itemToPlan(target, { x: s * (target.w / 2 - 420), y: 120 });
    const outward = headingOf(rotate({ x: s, y: 0 }, target.rotation));
    const bedTop = target.h;
    const t1 = T0 + 0.6, t2 = t1 + 1.6, t3 = t2 + 2.4, t4 = t3 + 1.0, t5 = t4 + 2.4, t6 = t5 + 2.4;
    keys = [
      k(T0, { pose: SEATED }),
      k(t1, { pose: SEATED }),
      k(t2, { pose: prepPose, z: prep.z - 10 }),
      k(t3, { x: edge.x, y: edge.y, z: bedTop + sitOff, heading: angleLerp(parked.heading, outward, 0.55), pose: midPose }, 70),
      k(t4, { x: edge.x, y: edge.y, z: bedTop + sitOff, heading: outward, pose: SEATED_REST }),
      k(t5, { x: sit.x, y: sit.y, z: bedTop + sitOff + 5, heading: target.rotation, pose: LONG_SIT }),
      k(t6, { x: sit.x, y: sit.y, z: bedTop + lieOff, heading: target.rotation, pitch: -90, pose: LYING }),
    ];
    tEnd = t6 + 1.2;
    phases.push({ t: t1, label: 'Prepare' }, { t: t2, label: 'Transfer' }, { t: t4, label: 'Legs onto bed' }, { t: t5, label: 'Lie down' });
  } else if ((type === 'toilet-transfer' || type === 'chair-transfer') && target) {
    const so = seatOf(target, s);
    const seat = itemToPlan(target, { x: so.x, y: so.y });
    const t1 = T0 + 0.6, t2 = t1 + 1.6, t3 = t2 + 2.6, t4 = t3 + 1.4;
    keys = [
      k(T0, { pose: SEATED }),
      k(t1, { pose: SEATED }),
      k(t2, { pose: prepPose, z: prep.z - 10 }),
      k(t3, { x: seat.x, y: seat.y, z: so.h + sitOff, heading: target.rotation, pose: midPose }, 70),
      k(t4, { x: seat.x, y: seat.y, z: so.h + sitOff, heading: target.rotation, pose: SEATED_REST }),
    ];
    tEnd = t4 + 1.5;
    phases.push({ t: t1, label: 'Prepare' }, { t: t2, label: 'Transfer' }, { t: t3, label: 'Seated' });
  } else if (type === 'cupboard' && target) {
    // the door is to the person's left as they face the cupboard, hinged on its outer edge so it
    // swings away from the chair; the left hand opens it
    const L = (p: Pose) => mirrorPose(p);
    const t1 = T0 + 0.6, t2 = t1 + 1.4, t3 = t2 + 1.2, t4 = t3 + 1.2, t5 = t4 + 1.6, t6 = t5 + 1.2, t7 = t6 + 1.2, t8 = t7 + 1.2, t9 = t8 + 1.2;
    keys = [
      k(T0, { pose: SEATED }), k(t1, { pose: SEATED }),
      k(t2, { pose: L(REACH_LOW_R) }), k(t3, { pose: L(OPEN_SWING_R) }),
      k(t4, { pose: REACH_IN }), k(t5, { pose: REACH_IN }),
      k(t6, { pose: L(HOLD_ITEM_R) }), k(t7, { pose: L(OPEN_SWING_R) }), k(t8, { pose: L(REACH_LOW_R) }), k(t9, { pose: L(HOLD_ITEM_R) }),
    ];
    tEnd = t9 + 1.2;
    phases.push({ t: t1, label: 'Reach for the handle' }, { t: t2, label: 'Open the door' }, { t: t3, label: 'Reach in' }, { t: t6, label: 'Close the door' });
    const tall = target.kind === 'wardrobe';
    const doorW = Math.min(500, target.w / 2), doorH = tall ? 1900 : Math.min(720, target.h - 180);
    const centreX = Math.max(-target.w / 2 + doorW / 2, -(doorW / 2 + 120));
    const openA = (t: number) => (t < t2 ? 0 : t < t3 ? 100 * ease((t - t2) / (t3 - t2)) : t < t7 ? 100 : t < t8 ? 100 * (1 - ease((t - t7) / (t8 - t7))) : 0);
    props = [{ item: target, hingeX: centreX - doorW / 2, w: doorW, h: doorH, elevation: tall ? 50 : 100, angle: openA }];
  } else if (type === 'basin' && target) {
    const t1 = T0 + 0.4, t2 = t1 + 1.4, t3 = t2 + 3;
    keys = [k(T0, { pose: SEATED }), k(t1, { pose: SEATED }), k(t2, { pose: REACH_FORWARD }), k(t3, { pose: REACH_FORWARD })];
    tEnd = t3 + 1.2;
    phases.push({ t: t1, label: 'Reach' });
  }
  const after = keyTrack(keys);
  const person = (t: number) => {
    if (t < T0) return personTravel(t);
    const st = after(t);
    if (type === 'basin' && t > keys[2].t && t < keys[3].t) {
      // small hand-washing movement
      const w = Math.sin((t - keys[2].t) * 7) * 6;
      st.pose.shoulderL = [st.pose.shoulderL[0] + w, st.pose.shoulderL[1], st.pose.shoulderL[2]];
      st.pose.shoulderR = [st.pose.shoulderR[0] - w, st.pose.shoulderR[1], st.pose.shoulderR[2]];
    }
    return st;
  };

  let helper: BuiltActivity['helper'];
  if (settings.supportPerson && type !== 'basin' && type !== 'cupboard') {
    // helper stands in front of the chair, on the open side, to assist
    const awaySide = type === 'bed-transfer' ? -s : s; // side of the chair away from the bed/toilet (bed-local)
    const front = add(parked, rotate({ x: 0, y: C.length / 2 + 380 }, parked.heading));
    const side = add(parked, rotate({ x: awaySide * (C.width / 2 + 380) * (type === 'bed-transfer' ? 1 : 1), y: 0 }, parked.heading));
    const assistAt = type === 'bed-transfer'
      ? itemToPlan(target!, { x: s * (target!.w / 2 + 280), y: -620 })
      : itemToPlan(target!, { x: 0, y: target!.d / 2 + 380 });
    const assistHeading = headingOf({ x: (keys[3]?.s.x ?? parked.x) - assistAt.x, y: (keys[3]?.s.y ?? parked.y) - assistAt.y });
    const tA = keys[1].t, tB = keys[2].t;
    const hf = helperFollow(T0);
    const hKeys: Key[] = [
      { t: T0, s: { ...hf, pose: STANDING } },
      { t: tA, s: { ...hf, x: side.x, y: side.y, heading: headingOf({ x: front.x - side.x, y: front.y - side.y }), pose: STANDING } },
      { t: tB, s: { ...hf, x: assistAt.x, y: assistAt.y, heading: assistHeading, pose: ASSIST } },
      { t: keys[3].t, s: { ...hf, x: assistAt.x, y: assistAt.y, heading: assistHeading, pose: ASSIST } },
      { t: keys[keys.length - 1].t, s: { ...hf, x: assistAt.x, y: assistAt.y, heading: assistHeading, pose: STANDING } },
    ];
    const ht = keyTrack(hKeys);
    helper = (t) => {
      if (t < T0) return helperFollow(t);
      const st = ht(t);
      if (t > T0 && t < tB) st.pose = walkPose(((t - T0) * 0.9) % 1);
      return st;
    };
  }

  return {
    type, duration: tEnd, route, phases, target, problem, side: s > 0 ? 'right' : 'left',
    parking: { x: parked.x, y: parked.y, heading: parked.heading },
    chair: (t) => (t < T0 ? chairAt(t) : { ...parked, moving: false }),
    person,
    helper,
    props,
    mh: p2 ? { person: p2Mix, carer: helper ? () => ({ a: { kind: 'pose' }, w: 0 }) : undefined } : undefined,
  };
};
