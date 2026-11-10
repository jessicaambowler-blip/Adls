import { useState } from 'react';
import { BATHROOM_TEMPLATES, rampLength, rampNote } from '../model/place';
import { useStore, type Placing, type Tool } from '../model/store';
import type { Item, ItemKind } from '../model/types';
import { NumberField, Segmented } from './controls';

// A tool palette in the style OTs know from OT Draw: building, bathroom, rails, structures and
// furniture grouped down the side of the drawing; pick one, then click where it goes (on the plan
// or in 3D). Ramps and bathroom layouts ask a few questions first.

type Entry = { icon: string; label: string; title: string } & ({ tool: Tool; plan?: boolean } | { place: Placing } | { dialog: 'ramp' | 'templates' });

const it = (kind: ItemKind, icon: string, label: string, title = label, over?: Partial<Item>): Entry => ({ icon, label, title: `${title} – click to place`, place: { what: 'item', kind, label, over } });
const op = (kind: 'door' | 'sliding-door' | 'opening' | 'window', icon: string, label: string, width?: number): Entry => ({ icon, label, title: `${label} – click on a wall`, place: { what: 'opening', kind, label, width } });

const GROUPS: { name: string; entries: Entry[] }[] = [
  {
    name: 'Building', entries: [
      { icon: '✎', label: 'Walls', title: 'Draw walls corner to corner (type a length + Enter)', tool: 'draw-wall', plan: true },
      { icon: '▭', label: 'Room', title: 'Drag out a new room', tool: 'add-room', plan: true },
      { icon: '✂', label: 'Split', title: 'Split a wall so part of it can move', tool: 'split-wall', plan: true },
      op('door', '🚪', 'Door', 870), op('sliding-door', '⇄', 'Sliding door', 920), op('opening', '⊓', 'Opening', 1000), op('window', '▦', 'Window', 1200),
      { icon: 'T', label: 'Name', title: 'Write a room name on the plan', tool: 'add-label', plan: true },
    ],
  },
  {
    name: 'Bathroom', entries: [
      it('toilet', '🚽', 'Toilet'), it('basin', '◡', 'Wall basin'), it('vanity', '▬', 'Vanity'), it('shower', '🚿', 'Shower'), it('bath', '🛁', 'Bath'), it('shower-commode', '♿', 'Commode'),
      { icon: '⊞', label: 'Layouts…', title: 'Bathroom layouts: accessible shower room, bath to shower, toilet rails', dialog: 'templates' },
    ],
  },
  {
    name: 'Rails', entries: [
      it('grab-rail', '━', 'Rail 900', 'Straight grab rail 900 mm at 800 mm', { w: 900 }), it('grab-rail', '─', 'Rail 600', 'Straight grab rail 600 mm at 800 mm', { w: 600 }), it('grab-rail-l', '┘', 'L rail', 'L-shaped grab rail (700 × 700) at 800 mm'),
    ],
  },
  {
    name: 'Structures', entries: [
      { icon: '◺', label: 'Ramp…', title: 'Ramp: answer the rise and gradient, then place it', dialog: 'ramp' },
      it('step', '▁', 'Step', 'Step or threshold (set its height)'), it('turning-space', '◯', 'Turning ⌀', 'Turning space marker (1500 mm)'),
    ],
  },
  {
    name: 'Furniture', entries: [
      it('bed-adjustable', '🛏', 'Care bed'), it('bed-single', '▭', 'Single bed'), it('bed-queen', '▢', 'Queen bed'), it('bedside-table', '▫', 'Bedside'),
      it('wardrobe', '▤', 'Wardrobe'), it('armchair', '🪑', 'Armchair'), it('sofa', '🛋', 'Sofa'), it('dining-table', '▭', 'Table'),
      it('dining-chair', '⑃', 'Chair'), it('kitchen-bench', '▬', 'Bench'), it('fridge', '▯', 'Fridge'), it('mobile-hoist', '⛓', 'Hoist'),
    ],
  },
];

export const BuildPalette = () => {
  const tool = useStore((s) => s.tool);
  const placing = useStore((s) => s.placing);
  const set = useStore((s) => s.set);
  const viewMode = useStore((s) => s.viewMode);
  const gridMm = useStore((s) => s.gridMm);
  const grid3d = useStore((s) => s.grid3d);
  const [open, setOpen] = useState<Record<string, boolean>>({ Building: true, Bathroom: true, Rails: true, Structures: true, Furniture: false });
  const [dialog, setDialog] = useState<'ramp' | 'templates' | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const isOn = (e: Entry) => ('tool' in e && tool === e.tool) || ('place' in e && tool === 'place' && placing && JSON.stringify(placing) === JSON.stringify(e.place));
  const choose = (e: Entry) => {
    if ('dialog' in e) { setDialog(e.dialog); return; }
    if ('tool' in e) { set({ tool: e.tool, placing: undefined, selection: null, ...(e.plan && viewMode === '3d' ? { viewMode: 'split' as const } : {}) }); return; }
    set({ tool: 'place', placing: e.place, selection: null });
  };

  if (collapsed) return <button className="palette-open" onClick={() => setCollapsed(false)} title="Show the build tools">🧰 Build</button>;
  return (
    <div className="palette" role="toolbar" aria-label="Build tools">
      <div className="palette-top">
        <button className={tool === 'select' ? 'on' : ''} onClick={() => set({ tool: 'select', placing: undefined })} title="Select and move things">↖ Select</button>
        <button className="palette-hide" onClick={() => setCollapsed(true)} title="Hide the build tools" aria-label="Hide build tools">«</button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.name} className="palette-group">
          <button className="palette-head" onClick={() => setOpen({ ...open, [g.name]: !open[g.name] })} aria-expanded={open[g.name]}>
            <span>{open[g.name] ? '▾' : '▸'} {g.name}</span><small>{g.entries.length}</small>
          </button>
          {open[g.name] && (
            <div className="palette-grid">
              {g.entries.map((e) => (
                <button key={e.label} className={isOn(e) ? 'on' : ''} onClick={() => choose(e)} title={e.title} aria-label={e.title}>
                  <span className="pi" aria-hidden>{e.icon}</span><span className="pl">{e.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="palette-foot">
        <label title="Moving and drawing snap to this step">Align to grid
          <select value={gridMm} onChange={(e) => set({ gridMm: +e.target.value })}>
            {[1, 10, 50, 100].map((v) => <option key={v} value={v}>{v === 1 ? 'Off' : `${v} mm`}</option>)}
          </select>
        </label>
        <label className="chk"><input type="checkbox" checked={grid3d} onChange={(e) => set({ grid3d: e.target.checked })} /> Grid in 3D</label>
      </div>
      {dialog === 'ramp' && <RampDialog onClose={() => setDialog(null)} />}
      {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
    </div>
  );
};

const RampDialog = ({ onClose }: { onClose: () => void }) => {
  const set = useStore((s) => s.set);
  const [rise, setRise] = useState(300);
  const [gradient, setGradient] = useState(14);
  const [width, setWidth] = useState(1000);
  const [landing, setLanding] = useState(1200);
  const [rails, setRails] = useState<'both' | 'left' | 'right' | 'none'>('both');
  const r = { rise, gradient, landing, rails };
  const len = rampLength(r);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Ramp">
      <div className="modal-card">
        <h2>Ramp</h2>
        <div className="grid2">
          <NumberField label="Height to climb (rise)" value={rise} onChange={setRise} step={10} min={10} max={1500} />
          <NumberField label="Ramp width" value={width} onChange={setWidth} step={50} min={700} max={2500} />
          <NumberField label="Landing at the top" value={landing} onChange={setLanding} step={100} min={0} max={3000} />
        </div>
        <div className="row-label">Gradient</div>
        <Segmented label="Gradient" value={String(gradient)} onChange={(v) => setGradient(+v)} options={[8, 10, 14, 20].map((g) => ({ value: String(g), label: `1:${g}` }))} />
        <div className="row-label">Handrails</div>
        <Segmented label="Handrails" value={rails} onChange={setRails} options={[{ value: 'both', label: 'Both sides' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'none', label: 'None' }]} />
        <p className="callout">Length <b>{len} mm</b> ({Math.round(rise * gradient)} mm slope + {landing} mm landing). {rampNote(r)}</p>
        <div className="btnrow">
          <button className="primary" onClick={() => { set({ tool: 'place', selection: null, placing: { what: 'item', kind: 'ramp', label: 'Ramp', over: { w: width, d: len, h: rise, ramp: r } } }); onClose(); }}>Place the ramp</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

const TemplatesDialog = ({ onClose }: { onClose: () => void }) => {
  const set = useStore((s) => s.set);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Bathroom layouts">
      <div className="modal-card">
        <h2>Bathroom layouts</h2>
        <div className="activity-list">
          {BATHROOM_TEMPLATES.map((t) => (
            <button key={t.id} className="card" onClick={() => { set({ tool: 'place', selection: null, placing: { what: 'template', id: t.id, label: t.label } }); onClose(); }}>
              <b>{t.label}</b><span>Min. room {t.min[0]} × {t.min[1]} mm</span>
            </button>
          ))}
        </div>
        <div className="btnrow"><button onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
};
