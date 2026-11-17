// Core data model. All plan coordinates are in MILLIMETRES.
// Plan axes: x to the right, y "down the page" (like a printed floor plan).
// Rotations are in degrees, clockwise as seen on the plan.
// In 3D, 1 unit = 1 metre; plan x -> 3D x, plan y -> 3D z, height -> 3D y.

export type Vec2 = { x: number; y: number };

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number; // mm
  /** paint on each face, overriding the room's colour: [the side the wall normal points to, the other side] */
  paint?: [string | null, string | null];
}

export type OpeningKind = 'door' | 'sliding-door' | 'opening' | 'window';

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** distance (mm) along the wall from wall.a to the centre of the opening */
  offset: number;
  width: number; // overall leaf / frame width, mm
  height: number; // mm
  sill: number; // mm above floor (windows)
  /** which side the door swings to (+1 / -1 relative to wall normal) */
  swingSide: 1 | -1;
  /** hinge at the start (a-side) or end (b-side) of the opening */
  hinge: 'start' | 'end';
}

export type ItemKind =
  | 'bed-queen'
  | 'bed-single'
  | 'bed-adjustable'
  | 'bedside-table'
  | 'wardrobe'
  | 'drawers'
  | 'armchair'
  | 'recliner'
  | 'sofa'
  | 'dining-chair'
  | 'tv-unit'
  | 'desk'
  | 'toilet'
  | 'basin'
  | 'vanity'
  | 'shower'
  | 'shower-commode'
  | 'grab-rail'
  | 'grab-rail-l'
  | 'ramp'
  | 'surface'
  | 'fence'
  | 'gate'
  | 'garden-bed'
  | 'tree'
  | 'car'
  | 'car-space'
  | 'step'
  | 'bath'
  | 'mobile-hoist'
  | 'kitchen-bench'
  | 'fridge'
  | 'dining-table'
  | 'hall-table'
  | 'rug'
  | 'plant'
  | 'turning-space'
  | 'imported';

export interface Item {
  id: string;
  kind: ItemKind;
  label?: string;
  x: number; // centre, mm
  y: number; // centre, mm
  rotation: number; // degrees clockwise on plan; item "front" faces +y (down the page) at 0
  w: number; // width along local x, mm
  d: number; // depth along local y, mm
  h: number; // height, mm
  elevation?: number; // height above floor of the item's base, mm (e.g. wall-mounted rails)
  /** imported model asset id (kind === "imported") and its scale */
  modelScale?: number;
  assetId?: string;
  color?: string;
  /** shown on the plan only (the 3D model comes from an original VisADLs recording) */
  hidden3d?: boolean;
  /** ramps: rise (mm), gradient 1:N, top landing length (mm), handrails */
  /** outdoor ground surfaces */
  surface?: SurfaceKind;
  ramp?: { rise: number; gradient: number; landing: number; rails: 'both' | 'left' | 'right' | 'none' };
}

export type SurfaceKind = 'lawn' | 'pavers' | 'concrete' | 'gravel' | 'decking';

export type FloorFinish = 'timber' | 'tiles' | 'vinyl' | 'carpet' | 'concrete';

export interface PlanBackground {
  dataUrl: string;
  /** mm per image pixel */
  scale: number;
  x: number; // mm position of the image's top-left corner
  y: number;
  opacity: number;
  /** true once the user has set the scale from a known distance */
  calibrated?: boolean;
  pxWidth: number;
  pxHeight: number;
}

/** Finishes for one room; anything left out follows the whole house. */
export interface RoomFinish {
  floor?: FloorFinish;
  /** tint of the floor (carpet, vinyl and tile colours) */
  floorColour?: string;
  wallColour?: string;
  /** wall tiles: none, a splashback to 1200 mm, or floor to ceiling */
  wallTiles?: 'none' | 'half' | 'full';
  ceilingColour?: string;
  lights?: 'downlights' | 'pendant' | 'batten' | 'none';
}

/** A name written on the plan, e.g. a room name. The room's finishes go with its name. */
export interface PlanLabel { id: string; text: string; x: number; y: number; finish?: RoomFinish }

export interface Layout {
  name: string;
  walls: Wall[];
  /** height of the ground outside relative to the floor inside (mm, e.g. -150) */
  ground?: number;
  /** room names and other notes written on the plan */
  labels?: PlanLabel[];
  openings: Opening[];
  items: Item[];
  floor: FloorFinish;
  wallColor: string;
  ceilingHeight: number;
  background?: PlanBackground;
  /** walls were generated automatically and the measurements have not been confirmed yet */
  unverified?: boolean;
  /** where the activity starts and (for "move around") ends */
  start: Vec2 & { heading: number };
  end: Vec2;
  /** which item the activity targets (bed, toilet, basin…) */
  targetItemId?: string;
}

export type LayoutKey = 'existing' | 'proposed';

export type ActivityType =
  | 'navigate'
  | 'bed-transfer'
  | 'toilet-transfer'
  | 'basin'
  | 'cupboard'
  | 'chair-transfer'
  | 'imported'
  | 'original';

export type ChairType = 'manual' | 'power';

export interface PersonaSettings {
  name: string;
  heightCm: number;
  skin: string;
  hair: string;
  top: string;
  bottoms: string;
}

export interface ActivitySettings {
  type: ActivityType;
  /** who does the activity: the app's simple figure, or Persona 2 from the original VisADLs project */
  character?: 'figure' | 'p2';
  /** bed transfer method: the recorded hoist transfer (Persona 2 only) or a side (sliding) transfer */
  bedMethod?: 'hoist' | 'side';
  chair: ChairType;
  /** the client's wheelchair sizes (mm); used for routes and clearance checks */
  chairSpec?: import('./catalogue').ChairSpec;
  supportPerson: boolean;
  /** side of the bed/toilet to transfer from, as seen when facing its front */
  transferSide: 'auto' | 'left' | 'right';
  persona: PersonaSettings;
  showSweptPath: boolean;
  /** show turning circles and doorway checks */
  showClearances?: boolean;
  /** imported item to drive with the timeline when type === 'imported' */
  importedItemId?: string;
  /** which original VisADLs recording to play when type === 'original' */
  originalId?: string;
}

export type NoteCategory = 'concern' | 'preference' | 'idea' | 'question' | 'decision';

export interface Note {
  id: string;
  text: string;
  category: NoteCategory;
  layout: LayoutKey;
  activity: ActivityType;
  time: number; // seconds into the activity when the note was made
  pin?: Vec2;
  author: 'consumer' | 'ot' | 'other';
  createdAt: string;
}

export interface Project {
  version: 1;
  title: string;
  consumerName: string;
  otName: string;
  /** details for the written report */
  report?: { address?: string; organisation?: string; funding?: string; date?: string; goal?: string; recommendation?: string };
  layouts: Record<LayoutKey, Layout>;
  activity: ActivitySettings;
  notes: Note[];
}
