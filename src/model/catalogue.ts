import type { ItemKind } from './types';

export interface CatalogueEntry {
  kind: ItemKind;
  label: string;
  group: 'Bedroom' | 'Bathroom' | 'Living & kitchen' | 'Equipment' | 'Planning aids';
  w: number;
  d: number;
  h: number;
  elevation?: number;
  /** does it block wheelchair movement? */
  blocks: boolean;
  /** place it against a wall by default (used for "snap to wall") */
  wallMounted?: boolean;
  description: string;
}

// Dimensions are typical Australian products (mm). They are starting points
// only – every value is editable in the side panel.
export const CATALOGUE: CatalogueEntry[] = [
  { kind: 'bed-queen', label: 'Queen bed', group: 'Bedroom', w: 1530, d: 2030, h: 600, blocks: true, description: 'Standard queen bed, mattress top about 600 mm.' },
  { kind: 'bed-single', label: 'Single bed', group: 'Bedroom', w: 920, d: 1880, h: 550, blocks: true, description: 'Standard single bed.' },
  { kind: 'bed-adjustable', label: 'Adjustable (care) bed', group: 'Bedroom', w: 1000, d: 2150, h: 520, blocks: true, description: 'Height-adjustable care bed with side rails.' },
  { kind: 'bedside-table', label: 'Bedside table', group: 'Bedroom', w: 450, d: 400, h: 550, blocks: true, description: 'Small bedside table with drawer.' },
  { kind: 'wardrobe', label: 'Wardrobe', group: 'Bedroom', w: 1800, d: 600, h: 2100, blocks: true, wallMounted: true, description: 'Built-in wardrobe with sliding doors.' },
  { kind: 'drawers', label: 'Chest of drawers', group: 'Bedroom', w: 900, d: 450, h: 1000, blocks: true, wallMounted: true, description: 'Chest of drawers.' },
  { kind: 'armchair', label: 'Armchair', group: 'Living & kitchen', w: 800, d: 850, h: 950, blocks: true, description: 'Upholstered armchair.' },
  { kind: 'sofa', label: 'Sofa (3-seat)', group: 'Living & kitchen', w: 2100, d: 900, h: 850, blocks: true, description: 'Three-seat sofa, seat height about 450 mm.' },
  { kind: 'dining-chair', label: 'Dining chair', group: 'Living & kitchen', w: 450, d: 500, h: 900, blocks: true, description: 'Dining chair without arms, seat height about 460 mm.' },
  { kind: 'tv-unit', label: 'TV unit', group: 'Living & kitchen', w: 1600, d: 420, h: 1150, blocks: true, wallMounted: true, description: 'Low TV cabinet with television.' },
  { kind: 'desk', label: 'Desk', group: 'Living & kitchen', w: 1200, d: 600, h: 730, blocks: true, wallMounted: true, description: 'Desk / table with knee clearance.' },
  { kind: 'toilet', label: 'Toilet', group: 'Bathroom', w: 400, d: 700, h: 800, blocks: true, wallMounted: true, description: 'Toilet pan with cistern. Seat height about 460 mm.' },
  { kind: 'basin', label: 'Wall basin', group: 'Bathroom', w: 550, d: 450, h: 850, blocks: false, wallMounted: true, description: 'Wall-hung basin with knee clearance underneath.' },
  { kind: 'vanity', label: 'Vanity unit', group: 'Bathroom', w: 900, d: 480, h: 870, blocks: true, wallMounted: true, description: 'Vanity cabinet with basin (no knee clearance).' },
  { kind: 'shower', label: 'Shower area (level entry)', group: 'Bathroom', w: 1160, d: 1100, h: 2000, blocks: false, description: 'Level-entry shower area with hand shower and curtain.' },
  { kind: 'shower-commode', label: 'Shower commode chair', group: 'Equipment', w: 560, d: 700, h: 1000, blocks: true, description: 'Mobile shower commode chair.' },
  { kind: 'grab-rail', label: 'Grab rail', group: 'Bathroom', w: 900, d: 80, h: 40, elevation: 800, blocks: false, wallMounted: true, description: 'Stainless grab rail, centre height about 800 mm.' },
  { kind: 'bath', label: 'Bath', group: 'Bathroom', w: 1675, d: 760, h: 550, blocks: true, wallMounted: true, description: 'Standard built-in bath.' },
  { kind: 'mobile-hoist', label: 'Mobile hoist', group: 'Equipment', w: 650, d: 1250, h: 1450, blocks: true, description: 'Mobile patient hoist with sling bar.' },
  { kind: 'kitchen-bench', label: 'Kitchen bench', group: 'Living & kitchen', w: 2400, d: 600, h: 900, blocks: true, wallMounted: true, description: 'Kitchen bench run with cupboards and sink.' },
  { kind: 'fridge', label: 'Fridge', group: 'Living & kitchen', w: 700, d: 700, h: 1750, blocks: true, wallMounted: true, description: 'Upright fridge.' },
  { kind: 'dining-table', label: 'Dining table', group: 'Living & kitchen', w: 1500, d: 900, h: 740, blocks: true, description: 'Dining table.' },
  { kind: 'hall-table', label: 'Hall table', group: 'Living & kitchen', w: 1000, d: 350, h: 800, blocks: true, wallMounted: true, description: 'Narrow hall / console table.' },
  { kind: 'rug', label: 'Rug', group: 'Living & kitchen', w: 1600, d: 2300, h: 10, blocks: false, description: 'Floor rug (can catch castors).' },
  { kind: 'plant', label: 'Pot plant', group: 'Living & kitchen', w: 400, d: 400, h: 1100, blocks: true, description: 'Indoor plant.' },
  { kind: 'turning-space', label: 'Turning space marker', group: 'Planning aids', w: 1500, d: 1500, h: 5, blocks: false, description: 'Circle marking a turning space for discussion. Diameter is editable.' },
];

export const catalogueEntry = (kind: ItemKind): CatalogueEntry | undefined => CATALOGUE.find((c) => c.kind === kind);

export const itemBlocks = (kind: ItemKind) => {
  if (kind === 'imported') return false;
  return catalogueEntry(kind)?.blocks ?? true;
};

export const itemLabel = (kind: ItemKind, label?: string) => label || catalogueEntry(kind)?.label || 'Imported model';

/** Equipment dimensions used for planning (mm). */
export const CHAIRS = {
  manual: { label: 'Manual wheelchair', width: 640, length: 1000, seatHeight: 500 },
  power: { label: 'Powered wheelchair', width: 640, length: 1150, seatHeight: 520 },
} as const;
