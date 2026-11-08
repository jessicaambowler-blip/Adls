import { CHAIRS } from '../model/catalogue';
import { add, headingOf, itemToPlan, rotate } from '../model/geometry';
import { chairFootprint, obstaclesOf, planRoute, sampleAt, type RouteResult } from '../model/pathfinding';
import { getOriginal, sampleTrack, toPlan, ueYaw } from '../originals/originals';
import { polygonsOverlap } from '../model/geometry';
import type { ActivitySettings, ActivityType, Item, Layout, Vec2 } from '../model/types';
import {
  ASSIST, LONG_SIT, LYING, POWER_DRIVE, PUSH_HANDLES, REACH_FORWARD, SEATED, SEATED_REST, STANDING,
  TRANSFER_MID_R, TRANSFER_PREP_R, fullPose, lerpPose, mirrorPose, pushPose, walkPose, type Pose,
} from './poses';

export const ACTIVITY_INFO: Record<ActivityType, { label: string; needs?: string[]; blurb: string }> = {
  navigate: { label: 'Move around the room', blurb: 'Wheelchair travels from the start point to the end point. Drag the green and blue markers on the plan.' },
  'bed-transfer': { label: 'Bed transfer', needs: ['bed-queen', 'bed-single', 'bed-adjustable'], blurb: 'Approach the bed, side transfer onto the bed, then lie down.' },
  'toilet-transfer': { label: 'Toilet transfer', needs: ['toilet'], blurb: 'Approach the toilet and side transfer onto the seat.' },
  basin: { label: 'Use the basin', needs: ['basin', 'vanity', 'kitchen-bench'], blurb: 'Forward approach to the basin and reach the tap.' },
  imported: { label: 'Imported animation', blurb: 'Plays the animation stored in an imported 3D model (e.g. original VisADLs motion capture).' },
  original: { label: 'Original VisADLs recording', blurb: 'Real motion capture from the original VisADLs project, in the room where it was recorded.' },
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
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const angleLerp = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;

const PELVIS_BACK = 110; // pelvis sits this far behind the chair centre (mm)
const SEAT_PELVIS = 95; // pelvis (hip joint) height above the seat surface (mm)

const chairSeatTop = (chair: ActivitySettings['chair']) => CHAIRS[chair].seatHeight;

const personInChair = (c: { x: number; y: number; heading: number }, chair: ActivitySettings['chair'], pose: Required<Pose>, scale: number): BodyState => {
  const p = add(c, rotate({ x: 0, y: -PELVIS_BACK }, c.heading));
  return { x: p.x, y: p.y, z: chairSeatTop(chair) + SEAT_PELVIS * scale, heading: c.heading, pitch: 0, pose };
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

const findTarget = (layout: Layout, kinds: string[]): Item | undefined => {
  const preferred = layout.items.find((i) => i.id === layout.targetItemId && kinds.includes(i.kind));
  return preferred ?? layout.items.find((i) => kinds.includes(i.kind));
};

/** Build the full timeline for the chosen activity in a layout. */
export const buildActivity = (layout: Layout, settings: ActivitySettings, importedDuration = 0): BuiltActivity => {
  const C = CHAIRS[settings.chair];
  const scale = settings.persona.heightCm / 175;
  const manual = settings.chair === 'manual';
  let s = settings.transferSide === 'left' ? -1 : 1;
  const type = settings.type;

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
    const chairTrack = sc.props.find((p) => p.builtin)?.track;
    let dist = 0;
    let last: { x: number; y: number } | null = null;
    // distance travelled, for wheel rotation (precomputed at 10 fps)
    const travelled: number[] = [];
    if (chairTrack) {
      for (let f = 0; f < chairTrack.frames; f++) {
        const p = toPlan(sc, chairTrack.data[f * 7], chairTrack.data[f * 7 + 1]);
        if (last) dist += Math.hypot(p.x - last.x, p.y - last.y);
        travelled.push(dist);
        last = p;
      }
    }
    const chairAt = (t: number): ChairState => {
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
    const person = (t: number): BodyState => {
      const s = sampleTrack(sc.person.track, t);
      const p = toPlan(sc, s[0], s[1]);
      const c = chairAt(t);
      return { x: p.x, y: p.y, z: s[2] * 10, heading: c.heading, pitch: 0, pose: fullPose(SEATED) };
    };
    return { type, duration: sc.duration, phases: sc.phases, chair: chairAt, person };
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

  // chair parking pose for each activity (plan coordinates), for side `sd` (+1 = right as you face the item)
  const parkingFor = (sd: number): (Vec2 & { heading?: number }) | null => {
    if (!target) return null;
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
      return { ...itemToPlan(target, { x: sd * (target.w / 2 + C.width / 2 + 100), y: seatY + PELVIS_BACK }), heading: target.rotation };
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
  if (target && (type === 'bed-transfer' || type === 'toilet-transfer')) {
    if (settings.transferSide === 'auto') {
      const a = blockedAt(parkingFor(1)!).length, b = blockedAt(parkingFor(-1)!).length;
      s = b < a ? -1 : 1;
    }
    const hits = blockedAt(parkingFor(s)!);
    if (hits.length) problem = `On this side the wheelchair overlaps the ${[...new Set(hits)].join(' and ')} where it parks. Try the other side, or move things to make room.`;
  }
  const park = parkingFor(s);
  if (park) goal = park;

  const route = planRoute(layout, {
    start: layout.start,
    goal,
    chairWidth: C.width,
    chairLength: C.length,
    // straight final approach (mm); the chair reverses into the spot beside the toilet
    approach: type === 'basin' ? 700 : type === 'bed-transfer' ? 1000 : type === 'toilet-transfer' ? -750 : 0,
    speed: manual ? 700 : 800,
  });
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
    return personInChair(c, settings.chair, drivePose(sampleAt(route.samples, t).dist, c.moving), scale);
  };

  if (!target || type === 'navigate') {
    const duration = T0 + 1.5;
    return {
      type, duration, route, phases, target, problem,
      chair: chairAt, person: personTravel, helper: settings.supportPerson ? helperFollow : undefined,
    };
  }

  const prep = personInChair(parked, settings.chair, fullPose(SEATED), scale);
  // Which hand leads (the one nearest the target): beside the bed the chair faces the bed head,
  // so the bed is on the avatar's right when s < 0; beside the toilet the chair faces the same way
  // as the toilet, so the toilet is on the right when s > 0.
  const leadRight = type === 'toilet-transfer' ? s > 0 : s < 0;
  const prepPose = leadRight ? TRANSFER_PREP_R : mirrorPose(TRANSFER_PREP_R);
  const midPose = leadRight ? TRANSFER_MID_R : mirrorPose(TRANSFER_MID_R);

  let keys: Key[] = [];
  let tEnd = T0;
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
      k(t3, { x: edge.x, y: edge.y, z: bedTop + 95 * scale, heading: angleLerp(parked.heading, outward, 0.55), pose: midPose }, 70),
      k(t4, { x: edge.x, y: edge.y, z: bedTop + 95 * scale, heading: outward, pose: SEATED_REST }),
      k(t5, { x: sit.x, y: sit.y, z: bedTop + 100 * scale, heading: target.rotation, pose: LONG_SIT }),
      k(t6, { x: sit.x, y: sit.y, z: bedTop + 110 * scale, heading: target.rotation, pitch: -90, pose: LYING }),
    ];
    tEnd = t6 + 1.2;
    phases.push({ t: t1, label: 'Prepare' }, { t: t2, label: 'Transfer' }, { t: t4, label: 'Legs onto bed' }, { t: t5, label: 'Lie down' });
  } else if (type === 'toilet-transfer' && target) {
    const seat = itemToPlan(target, { x: 0, y: -target.d / 2 + 450 });
    const t1 = T0 + 0.6, t2 = t1 + 1.6, t3 = t2 + 2.6, t4 = t3 + 1.4;
    keys = [
      k(T0, { pose: SEATED }),
      k(t1, { pose: SEATED }),
      k(t2, { pose: prepPose, z: prep.z - 10 }),
      k(t3, { x: seat.x, y: seat.y, z: 460 + 95 * scale, heading: target.rotation, pose: midPose }, 70),
      k(t4, { x: seat.x, y: seat.y, z: 460 + 95 * scale, heading: target.rotation, pose: SEATED_REST }),
    ];
    tEnd = t4 + 1.5;
    phases.push({ t: t1, label: 'Prepare' }, { t: t2, label: 'Transfer' }, { t: t3, label: 'Seated' });
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
  if (settings.supportPerson && type !== 'basin') {
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
  };
};
