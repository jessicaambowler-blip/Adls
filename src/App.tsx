import { useEffect, useRef } from 'react';
import { useActivity } from './activities/useActivity';
import { useStore, type ViewMode } from './model/store';
import type { LayoutKey, Project } from './model/types';
import { Scene3D } from './three/Scene3D';
import { ActivityPanel } from './ui/ActivityPanel';
import { Segmented } from './ui/controls';
import { NotesPanel } from './ui/NotesPanel';
import { PlanView } from './ui/PlanView';
import { RoomPanel } from './ui/RoomPanel';
import { Help, Summary } from './ui/Summary';
import { Timeline } from './ui/Timeline';
import { Dialogs, HOSTED, ask, notify } from './ui/dialogs';
import { loadOriginal, probeOriginals } from './originals/originals';
import { wallNormal } from './model/geometry';
import { applyWallDrag, beginWallDrag, removeWall, splitAtJunctions, tidyWalls } from './model/walls';
import type { Vec2 } from './model/types';

const LABEL: Record<LayoutKey, string> = { existing: 'Existing home', proposed: 'Proposed changes' };

const usePlayback = () => {
  const ex = useActivity('existing');
  const pr = useActivity('proposed');
  const compare = useStore((s) => s.compare);
  const active = useStore((s) => s.activeLayout);
  const duration = compare ? Math.max(ex.duration, pr.duration) : active === 'existing' ? ex.duration : pr.duration;
  useEffect(() => {
    const s = useStore.getState();
    useStore.setState({ duration, time: Math.min(s.time, duration) });
  }, [duration]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useStore.getState();
      if (s.playing) {
        const t = s.time + dt * s.speed;
        if (t >= s.duration) useStore.setState({ time: s.duration, playing: false });
        else useStore.setState({ time: t });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
};

const useKeyboard = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (e.key === ' ') { e.preventDefault(); s.set({ playing: !s.playing, time: !s.playing && s.time >= s.duration ? 0 : s.time }); return; }
      const sel = s.selection;
      if (sel?.type === 'wall') {
        const w = s.layout().walls.find((x) => x.id === sel.id);
        if (!w) return;
        const n = wallNormal(w);
        const step = e.shiftKey ? 100 : 10;
        const keyDir: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
        const d = keyDir[e.key];
        if (d) {
          const along = d.x * n.x + d.y * n.y; // only the direction across the wall moves it
          if (Math.abs(along) > 0.7) {
            e.preventDefault();
            s.updateLayout((l) => { splitAtJunctions(l); applyWallDrag(l, beginWallDrag(l, sel.id), Math.sign(along) * step); tidyWalls(l); });
          }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          if (s.layout().walls.length > 3) { s.updateLayout((l) => removeWall(l, sel.id)); s.set({ selection: null }); }
        }
        return;
      }
      if (sel?.type === 'item') {
        const step = e.shiftKey ? 100 : 10;
        const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (mv[e.key]) {
          e.preventDefault();
          s.updateLayout((l) => { const it = l.items.find((i) => i.id === sel.id); if (it) { it.x += mv[e.key][0]; it.y += mv[e.key][1]; } });
        } else if (e.key === 'r' || e.key === 'R') {
          s.updateLayout((l) => { const it = l.items.find((i) => i.id === sel.id); if (it) it.rotation = (it.rotation + (e.shiftKey ? 270 : 90)) % 360; });
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          s.updateLayout((l) => { l.items = l.items.filter((i) => i.id !== sel.id); });
          s.set({ selection: null });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};

const TopBar = () => {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const save = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(s.project, null, 1)], { type: 'application/json' }));
    a.download = `${s.project.title.replace(/[^\w-]+/g, '_')}.visadls.json`;
    a.click();
  };
  const open = async (f?: File) => {
    if (!f) return;
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (p.version !== 1 || !p.layouts) throw new Error('not a VisADLs project');
      s.loadProject(p);
    } catch (e) {
      notify(`Could not open that file: ${(e as Error).message}`);
    }
  };
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">Vis<b>ADLs</b></span><input className="title" value={s.project.title} onChange={(e) => s.updateProject({ title: e.target.value })} aria-label="Session title" /></div>
      <div className="layout-switch">
        <Segmented<LayoutKey> label="Layout" value={s.activeLayout} onChange={(k) => s.set({ activeLayout: k, selection: null })} options={[
          { value: 'existing', label: <><i className="dot existing" />Existing</> },
          { value: 'proposed', label: <><i className="dot proposed" />Proposed</> },
        ]} />
        <button className={s.compare ? 'on' : ''} onClick={() => s.set({ compare: !s.compare })} title="Show existing and proposed side by side">⇆ Compare</button>
        <button onClick={async () => { if (await ask('Copy the existing layout into “Proposed”, replacing what is there? You can undo this.', 'Copy to proposed')) s.copyExistingToProposed(); }} title="Start the proposed layout from the existing one">Copy existing → proposed</button>
      </div>
      <div className="right">
        <Segmented<ViewMode> label="View" value={s.viewMode} onChange={(v) => s.set({ viewMode: v })} options={[{ value: 'plan', label: 'Plan' }, { value: 'split', label: 'Both' }, { value: '3d', label: '3D' }]} />
        <button onClick={s.undo} disabled={!s.past.length} aria-label="Undo">↶</button>
        <button onClick={s.redo} disabled={!s.future.length} aria-label="Redo">↷</button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { open(e.target.files?.[0]); e.target.value = ''; }} />
        <button onClick={() => fileRef.current?.click()}>Open</button>
        {!HOSTED && <button onClick={save}>Save</button>}
        <button className="primary" onClick={() => s.set({ showSummary: true, playing: false })}>Summary</button>
        <button onClick={() => s.set({ showHelp: true })} aria-label="Help">?</button>
      </div>
    </header>
  );
};

const Sidebar = () => {
  const panel = useStore((s) => s.panel);
  const set = useStore((s) => s.set);
  const notes = useStore((s) => s.project.notes.length);
  return (
    <aside className="sidebar">
      <nav className="tabs" role="tablist">
        {([['room', '1 · Room'], ['activity', '2 · Activity'], ['notes', `3 · Notes${notes ? ` (${notes})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={panel === k} className={panel === k ? 'on' : ''} onClick={() => set({ panel: k })}>{l}</button>
        ))}
      </nav>
      {panel === 'room' && <RoomPanel />}
      {panel === 'activity' && <ActivityPanel />}
      {panel === 'notes' && <NotesPanel />}
    </aside>
  );
};

const Column = ({ k, mode, labelled }: { k: LayoutKey; mode: ViewMode; labelled: boolean }) => (
  <div className={`column mode-${mode}`}>
    {mode !== '3d' && <div className="pane plan-pane">{labelled && <div className={`pane-label ${k}`}>{LABEL[k]} · plan</div>}<PlanView layoutKey={k} /></div>}
    {mode !== 'plan' && <div className="pane"><Scene3D layoutKey={k} label={LABEL[k]} /></div>}
  </div>
);

export default function App() {
  useEffect(() => {
    probeOriginals();
    const id = useStore.getState().project.activity.originalId;
    if (useStore.getState().project.activity.type === 'original' && id) loadOriginal(id);
    // Persona 2 (MetaHuman) is built from her recording
    if (useStore.getState().project.activity.character === 'p2') loadOriginal('p2-bed-transfer');
    return useStore.subscribe((s, prev) => {
      if (s.project.activity.character === 'p2' && prev.project.activity.character !== 'p2') loadOriginal('p2-bed-transfer');
    });
  }, []);
  usePlayback();
  useKeyboard();
  const viewMode = useStore((s) => s.viewMode);
  const compare = useStore((s) => s.compare);
  const active = useStore((s) => s.activeLayout);
  const showSummary = useStore((s) => s.showSummary);
  const showHelp = useStore((s) => s.showHelp);
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <Sidebar />
        <section className="workspace">
          <div className={`views ${compare ? 'compare' : 'single'} mode-${viewMode}`}>
            {compare ? (
              <>
                <Column k="existing" mode={viewMode} labelled />
                <Column k="proposed" mode={viewMode} labelled />
              </>
            ) : (
              <Column k={active} mode={viewMode} labelled={false} />
            )}
          </div>
          <Timeline />
        </section>
      </main>
      {showSummary && <Summary />}
      {showHelp && <Help />}
      <Dialogs />
    </div>
  );
}
