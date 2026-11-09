import { ACTIVITY_INFO } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { CHAIRS, itemLabel } from '../model/catalogue';
import { diffLayouts, rectInfo } from '../model/edit';
import { clearOpening } from '../model/geometry';
import { useStore } from '../model/store';
import type { Layout, LayoutKey } from '../model/types';
import { RouteSummary } from './ActivityPanel';
import { fmtTime } from './controls';
import { CATEGORIES } from './NotesPanel';
import { HOSTED } from './dialogs';

const LayoutFacts = ({ l }: { l: Layout }) => {
  const r = rectInfo(l);
  const doors = l.openings.filter((o) => o.kind !== 'window');
  return (
    <ul>
      {r && <li>Room inside size: {r.width} × {r.depth} mm</li>}
      {doors.map((o) => <li key={o.id}>{o.kind === 'opening' ? 'Opening' : o.kind === 'sliding-door' ? 'Sliding door' : 'Door'} {o.width} mm (clear about {clearOpening(o)} mm)</li>)}
      <li>Items: {l.items.map((i) => itemLabel(i.kind, i.label)).join(', ') || 'none'}</li>
    </ul>
  );
};

const Shot = ({ k }: { k: LayoutKey }) => {
  const canvases = document.querySelectorAll<HTMLCanvasElement>(`.scene3d canvas`);
  // pick the canvas for this layout if two are showing, otherwise the only one
  const labels = [...document.querySelectorAll('.scene3d')];
  const idx = labels.findIndex((el) => el.querySelector(`.scene-label.${k}`));
  const c = canvases[idx >= 0 ? idx : 0];
  const active = useStore.getState().activeLayout;
  if (!c || (idx < 0 && active !== k)) return null;
  try {
    return <img className="shot" src={c.toDataURL('image/jpeg', 0.85)} alt={`3D view of the ${k} layout`} />;
  } catch {
    return null;
  }
};

export const Summary = () => {
  const p = useStore((s) => s.project);
  const set = useStore((s) => s.set);
  const update = useStore((s) => s.updateProject);
  const ex = useActivity('existing');
  const pr = useActivity('proposed');
  const changes = diffLayouts(p.layouts.existing, p.layouts.proposed);
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const download = () => {
    const el = document.getElementById('summary-doc');
    if (!el) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2em auto;padding:0 1em;color:#1d2733}h1,h2{color:#173a5e}img{max-width:100%;border:1px solid #ccc}.result{padding:.6em;border-left:4px solid #888;background:#f5f5f5;margin:.4em 0}.caveat{font-size:13px;color:#555}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}</style></head><body>${el.innerHTML}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `${p.title.replace(/[^\w-]+/g, '_')}_summary.html`;
    a.click();
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Session summary">
      <div className="modal-card wide">
        <div className="modal-actions no-print">
          {HOSTED ? <span className="muted">Printing and downloads are available in the installed version.</span> : (
            <>
              <button className="primary" onClick={() => window.print()}>Print / save as PDF</button>
              <button onClick={download}>Download summary</button>
            </>
          )}
          <button onClick={() => set({ showSummary: false })}>Close</button>
        </div>
        <div className="no-print grid2">
          <label className="text">Session title<input value={p.title} onChange={(e) => update({ title: e.target.value })} /></label>
          <label className="text">Consumer<input value={p.consumerName} onChange={(e) => update({ consumerName: e.target.value })} /></label>
          <label className="text">Occupational therapist<input value={p.otName} onChange={(e) => update({ otName: e.target.value })} /></label>
        </div>
        <article id="summary-doc" className="summary-doc">
          <h1>{p.title}</h1>
          <p>{date}{p.consumerName && <> · Consumer: {p.consumerName}</>}{p.otName && <> · OT: {p.otName}</>}</p>
          <p>Activity explored: <b>{ACTIVITY_INFO[p.activity.type].label}</b> with a {CHAIRS[p.activity.chair].label.toLowerCase()}{p.activity.supportPerson ? ' and a support person' : ''}.</p>

          <h2>Existing and proposed layouts</h2>
          <div className="two-col">
            <div><h3>Existing</h3><Shot k="existing" /><LayoutFacts l={p.layouts.existing} /><RouteSummary built={ex} layoutKey="existing" /></div>
            <div><h3>Proposed</h3><Shot k="proposed" /><LayoutFacts l={p.layouts.proposed} /><RouteSummary built={pr} layoutKey="proposed" /></div>
          </div>

          <h2>Changes being considered</h2>
          {changes.length ? (
            <table><tbody>{changes.map((c, i) => <tr key={i}><th>{c.what}</th><td>{c.detail}</td></tr>)}</tbody></table>
          ) : <p>No differences between existing and proposed layouts yet.</p>}

          <h2>Discussion notes</h2>
          {p.notes.length === 0 && <p>No notes recorded.</p>}
          {CATEGORIES.map((c) => {
            const ns = p.notes.filter((n) => n.category === c.value);
            if (!ns.length) return null;
            return (
              <div key={c.value}>
                <h3>{c.label}s</h3>
                <ul>{ns.map((n) => <li key={n.id}>{n.text} <small>({n.author === 'ot' ? 'OT' : n.author}, {n.layout} layout, {ACTIVITY_INFO[n.activity].label} at {fmtTime(n.time)}{n.pin ? ', pinned on plan' : ''})</small></li>)}</ul>
              </div>
            );
          })}

          <h2>About this summary</h2>
          <p className="caveat">
            These visualisations were created to support a shared conversation between the consumer and their occupational therapist.
            They are not a clinical assessment, building certification or a guarantee that a modification will work.
            Room measurements, door clear openings and equipment sizes must be checked on site. The movements shown are illustrative
            and do not represent how every person with a spinal cord injury moves.
          </p>
        </article>
      </div>
    </div>
  );
};

export const Help = () => {
  const set = useStore((s) => s.set);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="How to use">
      <div className="modal-card">
        <h2>How to use VisADLs</h2>
        <ol className="help-steps">
          <li><b>Room</b> – start from the demo house, a template, or an uploaded floor plan. The tools at the top of the plan: <b>Select</b> (drag furniture, doors, walls and wall corners), <b>Walls</b> (click corners to draw new walls; type a length and press Enter), <b>Room</b> (drag out a new room) and <b>Split</b> (cut a wall so just part of it can move). Moving a wall stretches the walls joined to it. Every number is in millimetres and can be typed in.</li>
          <li><b>Activity</b> – choose bed transfer, toilet transfer, using the basin or moving around. Press ▶ to watch. Drag the timeline to look at any moment.</li>
          <li><b>Views</b> – try “Seated eye level” to see from the wheelchair, or “From above” to see clearances.</li>
          <li><b>Existing / Proposed</b> – switch at the top. Make changes to “Proposed” and press “Compare” to see both side by side.</li>
          <li><b>Notes</b> – record concerns, preferences and decisions as you go. “Summary” makes a printable record.</li>
        </ol>
        <h3>Keyboard</h3>
        <p>Space: play/pause · Arrow keys: nudge selected item (Shift = 100 mm) · R: rotate 90° · Delete: remove · Ctrl+Z / Ctrl+Y: undo / redo</p>
        <h3>Please remember</h3>
        {HOSTED && <p className="muted">You are using the online preview: your work is kept in this browser only. To keep a copy, use the installed version, which can save project files.</p>}
        <p className="caveat">This is a research prototype for discussion. It does not check compliance with standards and is not a substitute for clinical reasoning or on-site measurement. The avatar and movements are placeholders until authentic VisADLs motion-capture assets are imported.</p>
        <div className="modal-actions"><button className="primary" onClick={() => set({ showHelp: false })}>Got it</button></div>
      </div>
    </div>
  );
};
