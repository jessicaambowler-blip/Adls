import { ACTIVITY_INFO } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { CHAIRS, itemLabel } from '../model/catalogue';
import { diffLayouts, rectInfo } from '../model/edit';
import { clearOpening, itemCorners, layoutBounds, solidWallRects, wallLength, wallNormal, wallPoint } from '../model/geometry';
import { rampLength } from '../model/place';
import type { Item } from '../model/types';
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
      {!!l.labels?.length && <li>Rooms: {l.labels.map((x) => x.text).join(', ')}</li>}
      <li>Doorways: {doors.map((o) => `${o.width} mm (≈${clearOpening(o)} clear)`).join(', ') || 'none'}</li>
      {l.items.length <= 10 && <li>Items: {l.items.map((i) => itemLabel(i.kind, i.label)).join(', ') || 'none'}</li>}
    </ul>
  );
};

/** A small drawing of a layout's walls, doors and furniture (used when there is no 3D picture of it). */
const MiniPlan = ({ l, route }: { l: Layout; route?: { x: number; y: number }[] }) => {
  const b = layoutBounds({ ...l, items: [] });
  const pad = 300;
  const vb = `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  const pts = (ps: { x: number; y: number }[]) => ps.map((q) => `${q.x},${q.y}`).join(' ');
  return (
    <svg className="shot miniplan" viewBox={vb} role="img" aria-label="Plan of the layout">
      {l.items.filter((i) => i.kind !== 'rug' && i.kind !== 'turning-space').map((i) => <polygon key={i.id} points={pts(itemCorners(i))} fill="#e9e3d8" stroke="#8a8f99" strokeWidth={20} />)}
      {solidWallRects(l).map((r, i) => <polygon key={i} points={pts(r)} fill="#39424e" />)}
      {route && <polyline points={pts(route)} fill="none" stroke="#1e88e5" strokeWidth={50} strokeDasharray="120 80" />}
      {(l.labels ?? []).map((lb) => <text key={lb.id} x={lb.x} y={lb.y} fontSize={260} textAnchor="middle" fill="#6b7785" fontWeight={700}>{lb.text}</text>)}
      {/* wall lengths (inside) and doorway widths, like a drawing */}
      {l.walls.filter((w) => wallLength(w) > 1500).map((w) => {
        const m = wallPoint(w, wallLength(w) / 2), n = wallNormal(w), o = w.thickness / 2 + 170;
        const vertical = Math.abs(w.a.x - w.b.x) < 1;
        return <text key={w.id} x={m.x + n.x * o} y={m.y + n.y * o + 60} fontSize={170} textAnchor="middle" fill="#1d2733" transform={vertical ? `rotate(-90 ${m.x + n.x * o} ${m.y + n.y * o})` : undefined}>{Math.round(wallLength(w) - w.thickness)}</text>;
      })}
      {l.openings.filter((o) => o.kind !== 'window').map((o) => {
        const w = l.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const c = wallPoint(w, o.offset);
        return <g key={o.id}><circle cx={c.x} cy={c.y} r={90} fill="#e53935" /><text x={c.x + 140} y={c.y - 120} fontSize={160} fill="#b71c1c" fontWeight={700}>{o.width}</text></g>;
      })}
      {l.items.filter((i) => i.kind === 'ramp' || i.kind.startsWith('grab-rail')).map((i) => <polygon key={`m${i.id}`} points={pts(itemCorners(i))} fill="none" stroke="#e67e00" strokeWidth={50} />)}
    </svg>
  );
};

/** Side view of a grab rail on its wall, with heights – as a drawing for a funding report. */
const RailElevation = ({ it }: { it: Item }) => {
  const wallW = it.w + 1200, H = 2100, e = it.elevation ?? 800, L = it.kind === 'grab-rail-l';
  const x0 = 600, x1 = 600 + it.w;
  return (
    <svg className="elev" viewBox={`-150 -150 ${wallW + 600} ${H + 450}`} role="img" aria-label={`Elevation of the ${itemLabel(it.kind, it.label)}`}>
      <rect x={0} y={0} width={wallW} height={H} fill="#f4f1ea" stroke="#8a8f99" strokeWidth={10} />
      <line x1={-100} y1={H} x2={wallW + 100} y2={H} stroke="#1d2733" strokeWidth={20} />
      <line x1={x0} y1={H - e} x2={x1} y2={H - e} stroke="#555" strokeWidth={36} strokeLinecap="round" />
      {L && <line x1={x1} y1={H - e} x2={x1} y2={H - e - it.h} stroke="#555" strokeWidth={36} strokeLinecap="round" />}
      <line x1={wallW + 120} y1={H} x2={wallW + 120} y2={H - e} stroke="#1d2733" strokeWidth={8} />
      <text x={wallW + 160} y={H - e / 2} fontSize={110}>{e} AFF</text>
      <text x={(x0 + x1) / 2} y={H - e + 150} fontSize={110} textAnchor="middle">{it.w}</text>
      {L && <text x={x1 + 60} y={H - e - it.h / 2} fontSize={110}>{it.h}</text>}
    </svg>
  );
};

/** Side profile of a ramp with its rise, length, gradient, landing and handrail height. */
const RampElevation = ({ it }: { it: Item }) => {
  const r = it.ramp!;
  const run = r.rise * r.gradient, len = rampLength(r), lift = Math.max(r.rise, 200);
  const sx = 1, rh = 900;
  // heights drawn 3× (marked) so a long, gentle ramp is still readable
  return (
    <svg className="elev" viewBox={`-200 -${(lift + rh) * 3 + 400} ${len + 900} ${(lift + rh) * 3 + 800}`} role="img" aria-label="Ramp side profile (heights exaggerated ×3)">
      <g transform="scale(1 3)">
      <line x1={-150} y1={0} x2={len + 300} y2={0} stroke="#1d2733" strokeWidth={14} />
      <polygon points={`0,0 ${run * sx},${-r.rise} ${len},${-r.rise} ${len},0`} fill="#d8d4cc" stroke="#6b6760" strokeWidth={14} />
      {r.rails !== 'none' && <polyline points={`-150,${-rh} 0,${-rh} ${run},${-r.rise - rh} ${len},${-r.rise - rh}`} fill="none" stroke="#555" strokeWidth={30} />}
      </g>
      <text x={run / 2} y={-(r.rise / 2) * 3 - 120} fontSize={170} textAnchor="middle" fontWeight={700}>1:{r.gradient}</text>
      <text x={run / 2} y={260} fontSize={150} textAnchor="middle">{Math.round(run)} slope</text>
      {r.landing > 0 && <text x={run + r.landing / 2} y={260} fontSize={150} textAnchor="middle">{r.landing} landing</text>}
      <text x={len + 60} y={-(r.rise / 2) * 3} fontSize={150}>rise {r.rise}</text>
      {r.rails !== 'none' && <text x={-150} y={-rh * 3 - 80} fontSize={130}>rails ~{rh} above surface (heights ×3)</text>}
    </svg>
  );
};

const Shot = ({ k, l, route }: { k: LayoutKey; l: Layout; route?: { x: number; y: number }[] }) => {
  const canvases = document.querySelectorAll<HTMLCanvasElement>(`.scene3d canvas`);
  // the 3D picture of this layout if it is on screen, otherwise a plan drawing
  const labels = [...document.querySelectorAll('.scene3d')];
  const idx = labels.findIndex((el) => el.querySelector(`.scene-label.${k}`));
  const c = canvases[idx >= 0 ? idx : 0];
  const active = useStore.getState().activeLayout;
  if (!c || (idx < 0 && active !== k)) return <MiniPlan l={l} route={route} />;
  try {
    return <img className="shot" src={c.toDataURL('image/jpeg', 0.85)} alt={`3D view of the ${k} layout`} />;
  } catch {
    return <MiniPlan l={l} route={route} />;
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
          <p>
            Activity explored: <b>{ACTIVITY_INFO[p.activity.type].label}</b>
            {p.activity.character === 'p2' ? <> by Persona 2</> : null} with a {CHAIRS[p.activity.chair].label.toLowerCase()}
            {p.activity.character === 'p2' && p.activity.type === 'bed-transfer' && p.activity.bedMethod !== 'side' ? <>, transferring with a ceiling hoist and a carer (recorded movement)</> : p.activity.supportPerson ? ' and a support person' : ''}.
          </p>

          <h2>Existing and proposed layouts</h2>
          <div className="two-col">
            <div><h3>Existing</h3><Shot k="existing" l={p.layouts.existing} route={ex.route?.samples.filter((_, i) => i % 5 === 0)} /><LayoutFacts l={p.layouts.existing} /><RouteSummary built={ex} layoutKey="existing" /></div>
            <div><h3>Proposed</h3><Shot k="proposed" l={p.layouts.proposed} route={pr.route?.samples.filter((_, i) => i % 5 === 0)} /><LayoutFacts l={p.layouts.proposed} /><RouteSummary built={pr} layoutKey="proposed" /></div>
          </div>

          <h2>Proposed modifications</h2>
          {changes.length ? (
            <table className="mods"><thead><tr><th>#</th><th>Modification</th><th>Details</th></tr></thead>
              <tbody>{changes.map((c, i) => <tr key={i}><td>{i + 1}</td><th>{c.what}</th><td>{c.detail}</td></tr>)}</tbody></table>
          ) : <p>No differences between existing and proposed layouts yet.</p>}

          <h2>Proposed plan</h2>
          <p className="caveat">Dimensions in mm. Not to scale.</p>
          <MiniPlan l={p.layouts.proposed} />

          {p.layouts.proposed.items.some((i) => i.kind === 'ramp' || i.kind.startsWith('grab-rail')) && (
            <>
              <h2>Elevations</h2>
              <div className="elevs">
                {p.layouts.proposed.items.filter((i) => i.kind.startsWith('grab-rail')).map((i, n) => <figure key={i.id}><RailElevation it={i} /><figcaption>{n + 1}. {itemLabel(i.kind, i.label)} – {i.w} mm{ i.kind === 'grab-rail-l' ? ` × ${i.h} mm` : ''}, {i.elevation ?? 800} mm above floor</figcaption></figure>)}
                {p.layouts.proposed.items.filter((i) => i.kind === 'ramp' && i.ramp).map((i) => <figure key={i.id}><RampElevation it={i} /><figcaption>Ramp – rise {i.ramp!.rise} mm at 1:{i.ramp!.gradient}, {i.w} mm wide, {rampLength(i.ramp!)} mm long including a {i.ramp!.landing} mm landing</figcaption></figure>)}
              </div>
            </>
          )}

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
            Room measurements, door clear openings and equipment sizes must be checked on site. Recorded movements (from the original
            VisADLs motion capture) show how one person did an activity on one occasion; other movements are demonstrations made by the
            app. Neither represents how every person with a spinal cord injury moves.
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
          <li><b>Room</b> – start from the demo house, a template, or a floor plan (upload it, click both ends of a printed measurement to set the scale, then let the app find the walls or trace them – the Walls tool snaps to walls drawn on the plan). Right-drag or hold Space to move around the plan while using any tool. The tools at the top of the plan: <b>Select</b> (drag furniture, doors, walls and wall corners), <b>Walls</b> (click corners to draw new walls; type a length and press Enter), <b>Room</b> (drag out a new room) and <b>Split</b> (cut a wall so just part of it can move). Moving a wall stretches the walls joined to it. Every number is in millimetres and can be typed in.</li>
          <li><b>Activity</b> – choose bed transfer, toilet transfer, using the basin or moving around. Press ▶ to watch. Drag the timeline to look at any moment.</li>
          <li><b>Views</b> – try “Seated eye level” to see from the wheelchair, or “From above” to see clearances.</li>
          <li><b>Existing / Proposed</b> – switch at the top. Make changes to “Proposed” and press “Compare” to see both side by side.</li>
          <li><b>Notes</b> – record concerns, preferences and decisions as you go. “Summary” makes a printable record.</li>
        </ol>
        <h3>Keyboard</h3>
        <p>Space: play/pause · 3D view: W A S D or arrow keys to move, Q / E to turn, R / F up and down, Shift faster, drag to look around · With something selected: arrow keys nudge it (Shift = 100 mm), R rotates 90°, Delete removes it · Ctrl+Z / Ctrl+Y: undo / redo</p>
        <h3>Please remember</h3>
        {HOSTED && <p className="muted">You are using the online preview: your work is kept in this browser only. To keep a copy, use the installed version, which can save project files.</p>}
        <p className="caveat">This is a research prototype for discussion. It does not check compliance with standards and is not a substitute for clinical reasoning or on-site measurement. Persona 2's driving and hoist transfer are recorded VisADLs motion capture; other movements are demonstrations made by the app.</p>
        <div className="modal-actions"><button className="primary" onClick={() => set({ showHelp: false })}>Got it</button></div>
      </div>
    </div>
  );
};
