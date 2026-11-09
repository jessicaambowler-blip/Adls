import { create } from 'zustand';
import { cloneLayout, defaultProject } from './templates';
import type { ActivitySettings, Layout, LayoutKey, Note, Project } from './types';

export type Selection =
  | { type: 'item'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'label'; id: string }
  | { type: 'start' }
  | { type: 'end' }
  | null;

export type CameraPreset = 'overview' | 'top' | 'seated' | 'support' | 'follow' | 'closeup' | 'free';
export type ViewMode = 'split' | '3d' | 'plan';
export type WallMode = 'cutaway' | 'full' | 'low';
export type Tool = 'select' | 'draw-room' | 'draw-wall' | 'add-room' | 'split-wall' | 'add-label' | 'move-plan' | 'calibrate' | 'pin-note' | 'detect-area';

/** Walls/openings proposed by automatic detection, waiting for review (plan mm). */
export interface DetectionProposal {
  walls: import('./types').Wall[];
  openings: import('./types').Opening[];
  counts: { walls: number; doors: number; windows: number; openings: number };
  layoutKey: import('./types').LayoutKey;
}

interface UiState {
  activeLayout: LayoutKey;
  selection: Selection;
  viewMode: ViewMode;
  compare: boolean;
  camera: CameraPreset;
  cameraNonce: number;
  wallMode: WallMode;
  highQuality: boolean;
  /** names and measurements on the plan, and contact tags in 3D (the selected thing always shows its own) */
  showLabels: boolean;
  tool: Tool;
  time: number;
  playing: boolean;
  speed: number;
  duration: number;
  panel: 'room' | 'activity' | 'notes';
  showSummary: boolean;
  showHelp: boolean;
  pendingPin?: { x: number; y: number };
  detection?: DetectionProposal;
  detecting?: boolean;
}

interface State extends UiState {
  project: Project;
  past: Project[];
  future: Project[];
  /** bumps whenever an imported asset is loaded so views can refresh */
  assetVersion: number;

  set: (p: Partial<UiState>) => void;
  layout: () => Layout;
  /** checkpoint for undo (call once before a drag or edit) */
  checkpoint: () => void;
  updateLayout: (fn: (l: Layout) => void, opts?: { commit?: boolean; key?: LayoutKey }) => void;
  replaceLayout: (l: Layout, key?: LayoutKey) => void;
  updateActivity: (p: Partial<ActivitySettings>) => void;
  updateProject: (p: Partial<Pick<Project, 'title' | 'consumerName' | 'otName'>>) => void;
  addNote: (n: Note) => void;
  updateNote: (id: string, p: Partial<Note>) => void;
  removeNote: (id: string) => void;
  copyExistingToProposed: () => void;
  loadProject: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  bumpAssets: () => void;
  selectCamera: (c: CameraPreset) => void;
}

const STORAGE_KEY = 'visadls-project-v1';

const loadSaved = (): Project | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    return p.version === 1 ? p : null;
  } catch {
    return null;
  }
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const useStore = create<State>((set, get) => ({
  project: loadSaved() ?? defaultProject(),
  past: [],
  future: [],
  assetVersion: 0,
  activeLayout: 'existing',
  selection: null,
  viewMode: typeof window !== 'undefined' && window.innerWidth < 1200 ? '3d' : 'split',
  compare: false,
  camera: 'overview',
  cameraNonce: 0,
  wallMode: 'cutaway',
  highQuality: true,
  showLabels: (() => { try { return localStorage.getItem('visadls-labels') !== 'off'; } catch { return true; } })(),
  tool: 'select',
  time: 0,
  playing: false,
  speed: 1,
  duration: 10,
  panel: 'room',
  showSummary: false,
  showHelp: false,

  set: (p) => set(p),
  layout: () => get().project.layouts[get().activeLayout],
  checkpoint: () => set((s) => ({ past: [...s.past.slice(-60), clone(s.project)], future: [] })),
  updateLayout: (fn, opts = {}) =>
    set((s) => {
      const key = opts.key ?? s.activeLayout;
      const project = clone(s.project);
      fn(project.layouts[key]);
      const past = opts.commit === false ? s.past : [...s.past.slice(-60), s.project];
      return { project, past, future: opts.commit === false ? s.future : [] };
    }),
  replaceLayout: (l, key) =>
    set((s) => {
      const k = key ?? s.activeLayout;
      return {
        project: { ...s.project, layouts: { ...s.project.layouts, [k]: l } },
        past: [...s.past.slice(-60), s.project],
        future: [],
        selection: null,
      };
    }),
  updateActivity: (p) => set((s) => ({ project: { ...s.project, activity: { ...s.project.activity, ...p } } })),
  updateProject: (p) => set((s) => ({ project: { ...s.project, ...p } })),
  addNote: (n) => set((s) => ({ project: { ...s.project, notes: [...s.project.notes, n] } })),
  updateNote: (id, p) =>
    set((s) => ({ project: { ...s.project, notes: s.project.notes.map((n) => (n.id === id ? { ...n, ...p } : n)) } })),
  removeNote: (id) => set((s) => ({ project: { ...s.project, notes: s.project.notes.filter((n) => n.id !== id) } })),
  copyExistingToProposed: () =>
    set((s) => ({
      project: {
        ...s.project,
        layouts: { ...s.project.layouts, proposed: cloneLayout(s.project.layouts.existing, 'Proposed') },
      },
      past: [...s.past.slice(-60), s.project],
      future: [],
    })),
  loadProject: (p) => set({ project: p, past: [], future: [], selection: null, time: 0, playing: false }),
  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], selection: null };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const [next, ...rest] = s.future;
      return { project: next, past: [...s.past, s.project], future: rest, selection: null };
    }),
  bumpAssets: () => set((s) => ({ assetVersion: s.assetVersion + 1 })),
  selectCamera: (c) => set((s) => ({ camera: c, cameraNonce: s.cameraNonce + 1 })),
}));

// Autosave (debounced) so a session survives an accidental refresh.
let saveTimer: number | undefined;
useStore.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      const p = clone(s.project);
      // background images can be large; keep them only if small enough for localStorage
      for (const k of ['existing', 'proposed'] as const) {
        const bg = p.layouts[k].background;
        if (bg && bg.dataUrl.length > 1_500_000) p.layouts[k].background = undefined;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {
      /* storage full or unavailable – ignore */
    }
  }, 600);
});
