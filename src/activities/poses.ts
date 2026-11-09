// Joint-angle poses for the procedural avatar. Angles in degrees (Euler XYZ, local to the parent joint).
// Avatar faces +z, y is up, +x is the avatar's LEFT.
// Conventions: shoulder/hip X < 0 swings the limb forward; elbow X < 0 bends the forearm forward;
// knee X > 0 bends the shin back; spine/neck X > 0 leans forward.

export const JOINTS = [
  'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR',
] as const;
export type Joint = (typeof JOINTS)[number];
export type Pose = Partial<Record<Joint, [number, number, number]>>;

const z3 = (): [number, number, number] => [0, 0, 0];

export const fullPose = (p: Pose): Required<Pose> => {
  const out = {} as Required<Pose>;
  for (const j of JOINTS) out[j] = p[j] ?? z3();
  return out;
};

export const lerpPose = (a: Pose, b: Pose, u: number): Required<Pose> => {
  const A = fullPose(a), B = fullPose(b);
  const out = {} as Required<Pose>;
  for (const j of JOINTS) out[j] = [0, 1, 2].map((i) => A[j][i] + (B[j][i] - A[j][i]) * u) as [number, number, number];
  return out;
};

/** mirror a pose left<->right */
export const mirrorPose = (p: Pose): Pose => {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p) as [Joint, [number, number, number]][]) {
    const m = (k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k) as Joint;
    out[m] = [v[0], -v[1], -v[2]];
  }
  return out;
};

export const STANDING: Pose = {
  shoulderL: [2, 0, 6], shoulderR: [2, 0, -6], elbowL: [-12, 0, 0], elbowR: [-12, 0, 0],
  kneeL: [3, 0, 0], kneeR: [3, 0, 0],
};

export const SEATED: Pose = {
  spine: [4, 0, 0], head: [-4, 0, 0],
  shoulderL: [-14, 0, 10], shoulderR: [-14, 0, -10], elbowL: [-58, 0, 0], elbowR: [-58, 0, 0],
  wristL: [0, 0, 0], wristR: [0, 0, 0],
  hipL: [-88, 0, 5], hipR: [-88, 0, -5], kneeL: [82, 0, 0], kneeR: [82, 0, 0], ankleL: [-6, 0, 0], ankleR: [-6, 0, 0],
};

/** hands on the push rims – phase 0 = hands back at the top of the rim, 1 = end of push */
export const pushPose = (phase: number): Required<Pose> => {
  const s = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0→1→0
  const back: Pose = { ...SEATED, spine: [10, 0, 0], shoulderL: [28, 0, 14], shoulderR: [28, 0, -14], elbowL: [-48, 0, 0], elbowR: [-48, 0, 0] };
  const front: Pose = { ...SEATED, spine: [18, 0, 0], shoulderL: [-38, 0, 12], shoulderR: [-38, 0, -12], elbowL: [-18, 0, 0], elbowR: [-18, 0, 0] };
  return lerpPose(back, front, s);
};

export const POWER_DRIVE: Pose = {
  ...SEATED,
  shoulderR: [-18, 0, -14], elbowR: [-78, 0, 0], wristR: [10, 0, 0],
  shoulderL: [-14, 0, 14], elbowL: [-70, 0, 0],
};

/** leaning forward, lead hand reaching to the transfer surface (transferring to the avatar's RIGHT) */
export const TRANSFER_PREP_R: Pose = {
  ...SEATED,
  spine: [30, 0, 0], chest: [6, 0, -6], head: [-22, 0, 0],
  shoulderR: [-30, 0, -32], elbowR: [-8, 0, 0], wristR: [-40, 0, 0],
  shoulderL: [-6, 0, 14], elbowL: [-10, 0, 0], wristL: [-40, 0, 0],
};

export const TRANSFER_MID_R: Pose = {
  ...SEATED,
  spine: [42, 0, 0], chest: [6, 0, 8], head: [-25, 0, 0],
  shoulderR: [-22, 0, -24], elbowR: [-4, 0, 0], wristR: [-50, 0, 0],
  shoulderL: [-6, 0, 22], elbowL: [-4, 0, 0], wristL: [-50, 0, 0],
  hipL: [-80, 0, 6], hipR: [-80, 0, -6], kneeL: [78, 0, 0], kneeR: [78, 0, 0],
};

export const SEATED_REST: Pose = {
  ...SEATED,
  spine: [2, 0, 0], shoulderL: [-8, 0, 18], shoulderR: [-8, 0, -18], elbowL: [-14, 0, 0], elbowR: [-14, 0, 0], wristL: [-60, 0, 0], wristR: [-60, 0, 0],
};

export const LONG_SIT: Pose = {
  spine: [6, 0, 0], head: [-6, 0, 0],
  shoulderL: [-4, 0, 22], shoulderR: [-4, 0, -22], elbowL: [-10, 0, 0], elbowR: [-10, 0, 0], wristL: [-60, 0, 0], wristR: [-60, 0, 0],
  hipL: [-88, 0, 4], hipR: [-88, 0, -4], kneeL: [4, 0, 0], kneeR: [4, 0, 0], ankleL: [20, 0, 0], ankleR: [20, 0, 0],
};

export const LYING: Pose = {
  head: [-8, 0, 0],
  shoulderL: [0, 0, 12], shoulderR: [0, 0, -12], elbowL: [-14, 0, 0], elbowR: [-14, 0, 0],
  hipL: [-4, 0, 4], hipR: [-4, 0, -4], kneeL: [6, 0, 0], kneeR: [6, 0, 0], ankleL: [24, 0, 0], ankleR: [24, 0, 0],
};

export const REACH_FORWARD: Pose = {
  ...SEATED,
  spine: [18, 0, 0], head: [8, 0, 0],
  shoulderL: [-62, 0, 8], shoulderR: [-62, 0, -8], elbowL: [-38, 0, 0], elbowR: [-38, 0, 0],
};

export const ASSIST: Pose = {
  spine: [28, 0, 0], head: [-18, 0, 0],
  shoulderL: [-55, 0, 14], shoulderR: [-55, 0, -14], elbowL: [-40, 0, 0], elbowR: [-40, 0, 0],
  hipL: [-38, 0, 8], hipR: [-38, 0, -8], kneeL: [52, 0, 0], kneeR: [52, 0, 0], ankleL: [-14, 0, 0], ankleR: [-14, 0, 0],
};

export const PUSH_HANDLES: Pose = {
  ...STANDING,
  spine: [6, 0, 0], shoulderL: [-38, 0, 4], shoulderR: [-38, 0, -4], elbowL: [-42, 0, 0], elbowR: [-42, 0, 0],
};

/** walking cycle for the support person. phase in [0,1). */
export const walkPose = (phase: number, base: Pose = STANDING): Required<Pose> => {
  const s = Math.sin(phase * Math.PI * 2);
  const c = Math.cos(phase * Math.PI * 2);
  const p = fullPose(base);
  p.hipL = [p.hipL[0] - 22 * s, p.hipL[1], p.hipL[2]];
  p.hipR = [p.hipR[0] + 22 * s, p.hipR[1], p.hipR[2]];
  p.kneeL = [p.kneeL[0] + Math.max(0, 40 * -c) + 5, 0, 0];
  p.kneeR = [p.kneeR[0] + Math.max(0, 40 * c) + 5, 0, 0];
  if (base === STANDING) {
    p.shoulderL = [p.shoulderL[0] + 16 * s, p.shoulderL[1], p.shoulderL[2]];
    p.shoulderR = [p.shoulderR[0] - 16 * s, p.shoulderR[1], p.shoulderR[2]];
  }
  return p;
};

// ---- demonstration movements (not motion capture) ----

/** leaning forward, right hand reaching down to a cupboard handle */
export const REACH_LOW_R: Pose = {
  ...SEATED,
  spine: [24, 0, 0], head: [6, 0, 0],
  shoulderR: [-58, 0, -8], elbowR: [-14, 0, 0], wristR: [-10, 0, 0],
};

/** right arm swept out to the side as a cupboard door is pulled open */
export const OPEN_SWING_R: Pose = {
  ...SEATED,
  spine: [16, -10, 0], head: [2, -12, 0],
  shoulderR: [-46, 0, -40], elbowR: [-24, 0, 0], wristR: [-10, 0, 0],
};

/** leaning in with both hands reaching into a low cupboard */
export const REACH_IN: Pose = {
  ...SEATED,
  spine: [32, 0, 0], chest: [6, 0, 0], head: [4, 0, 0],
  shoulderL: [-64, 0, 8], shoulderR: [-64, 0, -8], elbowL: [-18, 0, 0], elbowR: [-18, 0, 0], wristL: [-10, 0, 0], wristR: [-10, 0, 0],
};

/** sitting back holding something against the body with the right arm */
export const HOLD_ITEM_R: Pose = {
  ...SEATED,
  spine: [6, 0, 0],
  shoulderR: [-26, 0, -12], elbowR: [-100, 0, 0], wristR: [10, 0, 0],
};
