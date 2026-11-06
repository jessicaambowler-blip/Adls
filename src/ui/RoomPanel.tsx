import { useRef, useState } from 'react';
import { CATALOGUE, catalogueEntry, itemLabel } from '../model/catalogue';
import { clearOpening, layoutCentre, uid, wallLength } from '../model/geometry';
import { rectInfo, setRoomSize } from '../model/edit';
import { useStore } from '../model/store';
import { TEMPLATES, blankRoom, cloneLayout, makeItem } from '../model/templates';
import type { FloorFinish, Item, Opening } from '../model/types';
import { loadModelFile } from '../three/assets';
import { NumberField, Section, Segmented } from './controls';
import { ask, notify } from './dialogs';
import { acceptDetection } from './detectFlow';

const ReviewCard = () => {
  const d = useStore((s) => s.detection);
  const set = useStore((s) => s.set);
  const layout = useStore((s) => s.layout());
  const [clear, setClear] = useState(true);
  if (!d) return null;
  const c = d.counts;
  return (
    <div className="review-card" role="region" aria-label="Review detected walls">
      <h3>Walls found – please review</h3>
      <p className="muted">Found <b>{c.walls}</b> walls, <b>{c.doors}</b> doors, <b>{c.windows}</b> windows and <b>{c.openings}</b> other openings. Compare them with the plan underneath. Anything missing or wrong can be fixed after you accept.</p>
      <div className="legend-row">
        <span><i style={{ background: '#1565c0' }} />wall</span><span><i style={{ background: '#e53935' }} />door</span>
        <span><i style={{ background: '#00a3b4' }} />window</span><span><i style={{ background: '#f59f00' }} />opening / double door</span>
      </div>
      {!layout.background?.calibrated && <p className="callout">⚠ The plan's scale has not been set, so all sizes are guesses. Set the scale first for real measurements.</p>}
      {layout.items.length > 0 && (
        <label className="toggle-inline"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> Remove the current furniture</label>
      )}
      <div className="btnrow">
        <button className="primary" onClick={() => acceptDetection(clear)}>Use these walls</button>
        <button onClick={() => set({ detection: undefined, tool: 'detect-area' })}>Try a different area</button>
        <button onClick={() => set({ detection: undefined })}>Discard</button>
      </div>
    </div>
  );
};

const VerifyCard = () => {
  const layout = useStore((s) => s.layout());
  const updateLayout = useStore((s) => s.updateLayout);
  if (!layout.unverified) return null;
  return (
    <div className="verify-card">
      <h3>Check the measurements</h3>
      <p className="muted">These walls were found automatically from a drawing. Before relying on them, compare the room sizes and door widths with the plan's dimensions or a site measure. Click a wall or door to correct it.</p>
      <div className="btnrow"><button onClick={() => updateLayout((l) => { l.unverified = false; })}>I've checked the key measurements</button></div>
    </div>
  );
};

const FLOORS: { value: FloorFinish; label: string }[] = [
  { value: 'timber', label: 'Timber' }, { value: 'tiles', label: 'Tiles' }, { value: 'vinyl', label: 'Vinyl' }, { value: 'carpet', label: 'Carpet' },
];
const WALL_COLOURS = ['#ece6dc', '#f4f2ee', '#dfe6e3', '#e8dfd3', '#d9e1ea', '#efe3d0'];

const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });

const pdfToImage = async (f: File) => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2.5 });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
  return c.toDataURL('image/jpeg', 0.85);
};

const imgSize = (src: string) => new Promise<{ w: number; h: number }>((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = src; });

const ItemInspector = ({ it }: { it: Item }) => {
  const updateLayout = useStore((s) => s.updateLayout);
  const set = useStore((s) => s.set);
  const layout = useStore((s) => s.layout());
  const up = (p: Partial<Item>) => updateLayout((l) => { const x = l.items.find((i) => i.id === it.id); if (x) Object.assign(x, p); });
  const cat = catalogueEntry(it.kind);
  const isTargetable = ['bed-queen', 'bed-single', 'bed-adjustable', 'toilet', 'basin', 'vanity', 'kitchen-bench'].includes(it.kind);
  return (
    <div className="inspector">
      <h3>{itemLabel(it.kind, it.label)}</h3>
      {cat && <p className="muted">{cat.description}</p>}
      <div className="grid2">
        <NumberField label="Across (X)" value={it.x} onChange={(x) => up({ x })} step={50} />
        <NumberField label="Down (Y)" value={it.y} onChange={(y) => up({ y })} step={50} />
        {it.kind === 'turning-space' ? (
          <NumberField label="Diameter" value={it.w} onChange={(w) => up({ w, d: w })} step={50} min={500} />
        ) : (
          <>
            <NumberField label="Width" value={it.w} onChange={(w) => up({ w })} step={10} min={20} />
            <NumberField label="Depth" value={it.d} onChange={(d) => up({ d })} step={10} min={20} />
            <NumberField label="Height" value={it.h} onChange={(h) => up({ h })} step={10} min={5} help={it.kind.startsWith('bed') ? 'mattress top' : it.kind === 'toilet' ? 'cistern top' : undefined} />
            {(cat?.elevation !== undefined || it.kind === 'imported' || it.kind === 'basin') && (
              <NumberField label="Above floor" value={it.elevation ?? 0} onChange={(elevation) => up({ elevation })} step={10} min={0} />
            )}
          </>
        )}
        {it.kind === 'imported' && <NumberField label="Scale" unit="×" value={(it.modelScale ?? 1) * 100} onChange={(v) => up({ modelScale: v / 100 })} step={5} min={1} help="percent" />}
      </div>
      <div className="row-label">Turn</div>
      <div className="btnrow">
        <button onClick={() => up({ rotation: (it.rotation - 90 + 360) % 360 })}>⟲ 90°</button>
        <button onClick={() => up({ rotation: (it.rotation - 15 + 360) % 360 })}>⟲ 15°</button>
        <span className="pill">{Math.round(it.rotation)}°</span>
        <button onClick={() => up({ rotation: (it.rotation + 15) % 360 })}>15° ⟳</button>
        <button onClick={() => up({ rotation: (it.rotation + 90) % 360 })}>90° ⟳</button>
      </div>
      <div className="btnrow">
        {isTargetable && (
          <button className={layout.targetItemId === it.id ? 'primary' : ''} onClick={() => updateLayout((l) => { l.targetItemId = it.id; })}>
            {layout.targetItemId === it.id ? '✓ Activity uses this' : 'Use for activity'}
          </button>
        )}
        <button onClick={() => updateLayout((l) => { l.items.push({ ...it, id: uid('item'), x: it.x + 200, y: it.y + 200 }); })}>Duplicate</button>
        <button className="danger" onClick={() => { updateLayout((l) => { l.items = l.items.filter((i) => i.id !== it.id); }); set({ selection: null }); }}>Remove</button>
      </div>
      <p className="hint">Tip: drag it on the plan. Wall items snap to walls (hold Alt to stop snapping). Arrow keys nudge 10 mm (Shift = 100 mm).</p>
    </div>
  );
};

const OpeningInspector = ({ o }: { o: Opening }) => {
  const updateLayout = useStore((s) => s.updateLayout);
  const set = useStore((s) => s.set);
  const layout = useStore((s) => s.layout());
  const wall = layout.walls.find((w) => w.id === o.wallId);
  const up = (p: Partial<Opening>) => updateLayout((l) => { const x = l.openings.find((i) => i.id === o.id); if (x) Object.assign(x, p); });
  const L = wall ? wallLength(wall) : 0;
  const name = o.kind === 'window' ? 'Window' : o.kind === 'opening' ? 'Open doorway' : o.kind === 'sliding-door' ? 'Sliding door' : 'Door';
  return (
    <div className="inspector">
      <h3>{name}</h3>
      {o.kind !== 'window' && <p className="callout">Estimated clear opening: <b>{clearOpening(o)} mm</b><br /><small>Leaf width less door stops/leaf thickness – measure on site to confirm.</small></p>}
      <Segmented label="Type" value={o.kind} onChange={(kind) => up({ kind, ...(kind === 'window' ? { sill: 900, height: 1200 } : { sill: 0, height: 2040 }) })} options={[
        { value: 'door', label: 'Hinged' }, { value: 'sliding-door', label: 'Sliding' }, { value: 'opening', label: 'No door' }, { value: 'window', label: 'Window' },
      ]} />
      <div className="grid2">
        <NumberField label={o.kind === 'window' ? 'Width' : 'Door width'} value={o.width} onChange={(width) => up({ width: Math.min(width, L - 100) })} step={50} min={300} />
        <NumberField label="From wall start" value={o.offset - o.width / 2} onChange={(v) => up({ offset: Math.max(o.width / 2, Math.min(L - o.width / 2, v + o.width / 2)) })} step={50} min={0} />
        {o.kind === 'window' && <NumberField label="Sill height" value={o.sill} onChange={(sill) => up({ sill })} step={50} min={0} />}
        <NumberField label={o.kind === 'window' ? 'Window height' : 'Door height'} value={o.height} onChange={(height) => up({ height })} step={50} min={300} />
      </div>
      {o.kind !== 'window' && (
        <>
          <div className="row-label">Common door sizes</div>
          <div className="btnrow">{[720, 820, 870, 920, 1020].map((w) => <button key={w} className={o.width === w ? 'primary' : ''} onClick={() => up({ width: w })}>{w}</button>)}</div>
        </>
      )}
      {(o.kind === 'door' || o.kind === 'sliding-door') && (
        <div className="btnrow">
          <button onClick={() => up({ swingSide: o.swingSide === 1 ? -1 : 1 })}>{o.kind === 'door' ? 'Swing other way' : 'Slide on other face'}</button>
          {o.kind === 'door' && <button onClick={() => up({ hinge: o.hinge === 'start' ? 'end' : 'start' })}>Hinge other side</button>}
        </div>
      )}
      <div className="btnrow"><button className="danger" onClick={() => { updateLayout((l) => { l.openings = l.openings.filter((x) => x.id !== o.id); }); set({ selection: null }); }}>Remove</button></div>
    </div>
  );
};

const WallInspector = ({ id }: { id: string }) => {
  const layout = useStore((s) => s.layout());
  const updateLayout = useStore((s) => s.updateLayout);
  const set = useStore((s) => s.set);
  const w = layout.walls.find((x) => x.id === id);
  if (!w) return null;
  const L = wallLength(w);
  const addOpening = (kind: Opening['kind']) => {
    const width = kind === 'window' ? 1200 : 870;
    const o: Opening = { id: uid('open'), wallId: w.id, kind, offset: L / 2, width: Math.min(width, L - 200), height: kind === 'window' ? 1200 : 2040, sill: kind === 'window' ? 900 : 0, swingSide: 1, hinge: 'start' };
    updateLayout((l) => { l.openings.push(o); });
    set({ selection: { type: 'opening', id: o.id } });
  };
  return (
    <div className="inspector">
      <h3>Wall</h3>
      <p className="muted">Inside length about <b>{Math.round(L - w.thickness)} mm</b>. Drag the wall on the plan to move it – connected walls stretch to follow.</p>
      <NumberField label="Thickness" value={w.thickness} onChange={(t) => updateLayout((l) => { const x = l.walls.find((q) => q.id === id); if (x) x.thickness = t; })} step={10} min={50} max={400} />
      <div className="btnrow">
        <button onClick={() => addOpening('door')}>＋ Door</button>
        <button onClick={() => addOpening('sliding-door')}>＋ Sliding door</button>
        <button onClick={() => addOpening('opening')}>＋ Opening</button>
        <button onClick={() => addOpening('window')}>＋ Window</button>
      </div>
      {layout.walls.length > 3 && (
        <div className="btnrow"><button className="danger" onClick={() => { updateLayout((l) => { l.walls = l.walls.filter((x) => x.id !== id); l.openings = l.openings.filter((o) => o.wallId !== id); }); set({ selection: null }); }}>Remove wall</button></div>
      )}
    </div>
  );
};

const MarkerInspector = ({ which }: { which: 'start' | 'end' }) => {
  const layout = useStore((s) => s.layout());
  const updateLayout = useStore((s) => s.updateLayout);
  return (
    <div className="inspector">
      <h3>{which === 'start' ? 'Start point' : 'End point'}</h3>
      <p className="muted">{which === 'start' ? 'Where the wheelchair starts. The arrow shows which way it faces.' : 'Where the wheelchair should end up for “Move around the room”.'}</p>
      {which === 'start' && (
        <div className="btnrow">
          {[['↑', 180], ['→', 270], ['↓', 0], ['←', 90]].map(([l, h]) => (
            <button key={h} className={layout.start.heading === h ? 'primary' : ''} onClick={() => updateLayout((x) => { x.start.heading = h as number; })}>Face {l}</button>
          ))}
        </div>
      )}
    </div>
  );
};

export const RoomPanel = () => {
  const layout = useStore((s) => s.layout());
  const active = useStore((s) => s.activeLayout);
  const selection = useStore((s) => s.selection);
  const updateLayout = useStore((s) => s.updateLayout);
  const replaceLayout = useStore((s) => s.replaceLayout);
  const set = useStore((s) => s.set);
  const bump = useStore((s) => s.bumpAssets);
  const updateActivity = useStore((s) => s.updateActivity);
  const planInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [newW, setNewW] = useState(3600);
  const [newD, setNewD] = useState(3400);
  const rect = rectInfo(layout);

  const selItem = selection?.type === 'item' ? layout.items.find((i) => i.id === selection.id) : undefined;
  const selOpening = selection?.type === 'opening' ? layout.openings.find((o) => o.id === selection.id) : undefined;

  const addItem = (kind: Item['kind']) => {
    const c = layoutCentre(layout);
    const it = makeItem(kind, Math.round(c.x / 10) * 10, Math.round(c.y / 10) * 10);
    updateLayout((l) => { l.items.push(it); });
    set({ selection: { type: 'item', id: it.id } });
  };

  const applyTemplate = async (make: () => ReturnType<typeof blankRoom>) => {
    if (layout.items.length && !(await ask(`Replace the ${active} layout with this template? You can undo this.`, 'Replace layout'))) return;
    const l = make();
    replaceLayout(active === 'proposed' ? cloneLayout(l, 'Proposed') : l);
  };

  const onPlanFile = async (f?: File) => {
    if (!f) return;
    setBusy('Reading floor plan…');
    try {
      const dataUrl = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') ? await pdfToImage(f) : await readAsDataUrl(f);
      const { w, h } = await imgSize(dataUrl);
      const b = rect ? rect.width * 1.4 : 6000;
      updateLayout((l) => { l.background = { dataUrl, pxWidth: w, pxHeight: h, scale: b / w, x: -b * 0.2, y: -b * 0.2 * (h / w), opacity: 0.55 }; });
    } catch (e) {
      notify(`That file could not be read (${(e as Error).message}). Try a PNG, JPG or PDF.`);
    }
    setBusy('');
  };

  const onModelFile = async (f?: File) => {
    if (!f) return;
    setBusy(`Loading ${f.name}…`);
    try {
      const id = uid('asset');
      const a = await loadModelFile(f, id);
      const c = layoutCentre(layout);
      const it: Item = {
        id: uid('item'), kind: 'imported', label: f.name.replace(/\.[^.]+$/, ''), assetId: id, x: Math.round(c.x), y: Math.round(c.y), rotation: 0,
        w: Math.max(50, Math.round(a.size.x * 1000)), d: Math.max(50, Math.round(a.size.z * 1000)), h: Math.max(50, Math.round(a.size.y * 1000)), modelScale: 1,
      };
      updateLayout((l) => { l.items.push(it); });
      bump();
      set({ selection: { type: 'item', id: it.id } });
      if (a.clips.length && (await ask(`“${f.name}” contains ${a.clips.length} animation(s) (${a.clips[0].duration.toFixed(1)} s). Play it with the timeline as the activity?`, 'Play with timeline'))) {
        updateActivity({ type: 'imported', importedItemId: it.id });
        set({ time: 0 });
      }
    } catch (e) {
      notify(`That model could not be loaded (${(e as Error).message}). GLB files work best.`);
    }
    setBusy('');
  };

  const groups = [...new Set(CATALOGUE.map((c) => c.group))];

  return (
    <div className="panel-body">
      {busy && <div className="busy">{busy}</div>}
      <ReviewCard />
      <VerifyCard />
      {selItem && <ItemInspector it={selItem} />}
      {selOpening && <OpeningInspector o={selOpening} />}
      {selection?.type === 'wall' && <WallInspector id={selection.id} />}
      {(selection?.type === 'start' || selection?.type === 'end') && <MarkerInspector which={selection.type} />}
      {!selection && <p className="hint big">Click anything on the plan (or in 3D) to change it. Editing: <b className={`lk ${active}`}>{active === 'existing' ? 'Existing home' : 'Proposed changes'}</b></p>}

      <Section title="1. Start with a room" open={!selection}>
        <div className="tiles">
          {TEMPLATES.map((t) => <button key={t.id} className="tile" onClick={() => applyTemplate(t.make)}>{t.label}</button>)}
        </div>
        <div className="grid2">
          <NumberField label="New room width" value={newW} onChange={setNewW} step={100} min={1000} />
          <NumberField label="New room depth" value={newD} onChange={setNewD} step={100} min={1000} />
        </div>
        <div className="btnrow">
          <button onClick={() => applyTemplate(() => blankRoom(newW, newD))}>Create empty room</button>
          <button onClick={() => set({ tool: 'draw-room', selection: null })}>Draw room outline</button>
        </div>
      </Section>

      <Section title="2. Use an existing floor plan" open={!selection}>
        <p className="muted">Upload a plan (image or PDF). Set its scale by clicking two points a known distance apart, then let the app find the walls, doors and windows, or trace them yourself. Automatic results are a starting point and must be checked.</p>
        <input ref={planInput} type="file" accept="image/*,.pdf" hidden onChange={(e) => { onPlanFile(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="btnrow">
          <button onClick={() => planInput.current?.click()}>Upload floor plan…</button>
          {layout.background && <button className={layout.background.calibrated ? '' : 'primary'} onClick={() => set({ tool: 'calibrate', selection: null })}>{layout.background.calibrated ? 'Scale set ✓ – change' : 'Set scale'}</button>}
          {layout.background && (
            <button className={layout.background.calibrated ? 'primary' : ''} onClick={async () => {
              if (!layout.background?.calibrated && !(await ask('The plan’s scale has not been set yet, so detected sizes will be wrong. Find walls anyway?', 'Find walls anyway'))) return;
              set({ tool: 'detect-area', selection: null, detection: undefined });
            }}>Find walls automatically</button>
          )}
          {layout.background && <button className="danger" onClick={() => updateLayout((l) => { l.background = undefined; })}>Remove plan</button>}
        </div>
        {layout.background && (
          <label className="slider">Plan visibility
            <input type="range" min={0.1} max={1} step={0.05} value={layout.background.opacity} onChange={(e) => updateLayout((l) => { if (l.background) l.background.opacity = +e.target.value; }, { commit: false })} />
          </label>
        )}
      </Section>

      <Section title="Room size & finishes" open={!selection}>
        {rect ? (
          <div className="grid2">
            <NumberField label="Inside width" value={rect.width} onChange={(v) => updateLayout((l) => setRoomSize(l, v))} step={50} min={800} />
            <NumberField label="Inside depth" value={rect.depth} onChange={(v) => updateLayout((l) => setRoomSize(l, undefined, v))} step={50} min={800} />
          </div>
        ) : <p className="muted">This room has a custom outline – drag walls on the plan to resize.</p>}
        <NumberField label="Ceiling height" value={layout.ceilingHeight} onChange={(v) => updateLayout((l) => { l.ceilingHeight = v; })} step={50} min={2100} max={4000} />
        <div className="row-label">Floor</div>
        <Segmented label="Floor finish" value={layout.floor} options={FLOORS} onChange={(floor) => updateLayout((l) => { l.floor = floor; })} />
        <div className="row-label">Wall colour</div>
        <div className="swatches">
          {WALL_COLOURS.map((c) => <button key={c} style={{ background: c }} className={layout.wallColor === c ? 'on' : ''} onClick={() => updateLayout((l) => { l.wallColor = c; })} aria-label={`Wall colour ${c}`} />)}
        </div>
      </Section>

      <Section title="3. Furniture & equipment" open={!selection}>
        {groups.map((g) => (
          <div key={g}>
            <div className="row-label">{g}</div>
            <div className="chips">
              {CATALOGUE.filter((c) => c.group === g).map((c) => <button key={c.kind} onClick={() => addItem(c.kind)} title={c.description}>＋ {c.label}</button>)}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Import 3D models" open={false}>
        <p className="muted">Add your own furniture, equipment or animated people (GLB/glTF or FBX). Animated files – such as motion capture exported from the original VisADLs Unreal project – can be played with the timeline. Files stay on this computer.</p>
        <input ref={modelInput} type="file" accept=".glb,.gltf,.fbx" hidden onChange={(e) => { onModelFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button onClick={() => modelInput.current?.click()}>Import model…</button>
      </Section>
    </div>
  );
};
