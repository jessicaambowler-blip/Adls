import { ACTIVITY_INFO } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { chairOf, itemLabel } from '../model/catalogue';
import { diffLayouts, rectInfo } from '../model/edit';
import { clearOpening, itemCorners, layoutBounds, solidWallRects, wallLength, wallNormal, wallPoint } from '../model/geometry';
import { rampLength } from '../model/place';
import type { Item } from '../model/types';
import { useStore } from '../model/store';
import type { Layout, LayoutKey } from '../model/types';
import { RouteSummary } from './ActivityPanel';
import { useClearances } from '../activities/useClearances';
import type { Check } from '../model/clearance';
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

const Shot = ({ k, l, route, planIfNo3d = true }: { k: LayoutKey; l: Layout; route?: { x: number; y: number }[]; planIfNo3d?: boolean }) => {
  const canvases = document.querySelectorAll<HTMLCanvasElement>(`.scene3d canvas`);
  // the 3D picture of this layout if it is on screen, otherwise a plan drawing
  const labels = [...document.querySelectorAll('.scene3d')];
  const idx = labels.findIndex((el) => el.querySelector(`.scene-label.${k}`));
  const c = canvases[idx >= 0 ? idx : 0];
  const active = useStore.getState().activeLayout;
  if (!c || (idx < 0 && active !== k)) return planIfNo3d ? <MiniPlan l={l} route={route} /> : null;
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
  const r = p.report ?? {};
  const rep = (x: Partial<NonNullable<typeof p.report>>) => update({ report: { ...r, ...x } });
  const C = chairOf(p.activity);
  const clEx = useClearances('existing'), clPr = useClearances('proposed');
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const download = () => {
    const el = document.getElementById('summary-doc');
    if (!el) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${p.title}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:2em auto;padding:0 1em;color:#1d2733}h1,h2{color:#173a5e}img{max-width:100%;border:1px solid #ccc}.result{padding:.6em;border-left:4px solid #888;background:#f5f5f5;margin:.4em 0}.caveat{font-size:13px;color:#555}table{border-collapse:collapse;width:100%;margin:.5em 0}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f4f6f8}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}.elevs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}svg{max-width:100%;height:auto}.ok{color:#2e7d32}.tight{color:#b26a00}.no{color:#c62828}.signoff{display:flex;gap:24px;flex-wrap:wrap;margin:2em 0}.muted{color:#777}</style></head><body>${el.innerHTML}</body></html>`;
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
        <div className="no-print report-form">
          <label className="text">Report title<input value={p.title} onChange={(e) => update({ title: e.target.value })} /></label>
          <label className="text">Client<input value={p.consumerName} onChange={(e) => update({ consumerName: e.target.value })} /></label>
          <label className="text">Address<input value={r.address ?? ''} onChange={(e) => rep({ address: e.target.value })} /></label>
          <label className="text">Assessment date<input type="date" value={r.date ?? ''} onChange={(e) => rep({ date: e.target.value })} /></label>
          <label className="text">Occupational therapist<input value={p.otName} onChange={(e) => update({ otName: e.target.value })} /></label>
          <label className="text">Organisation<input value={r.organisation ?? ''} onChange={(e) => rep({ organisation: e.target.value })} /></label>
          <label className="text">Funding body
            <input list="funders" value={r.funding ?? ''} onChange={(e) => rep({ funding: e.target.value })} />
            <datalist id="funders">{['NDIS', 'My Aged Care / Support at Home', 'icare NSW', 'TAC', 'DVA', 'Private'].map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label className="text wide2">Reason for referral and goals<textarea rows={2} value={r.goal ?? ''} onChange={(e) => rep({ goal: e.target.value })} placeholder="e.g. Unable to access bedroom and bathroom in powered wheelchair; goal to transfer to bed with hoist and carer" /></label>
          <label className="text wide2">Recommendation<textarea rows={2} value={r.recommendation ?? ''} onChange={(e) => rep({ recommendation: e.target.value })} placeholder="Summary of what is recommended and why" /></label>
        </div>
        <article id="summary-doc" className="summary-doc">
          <header className="rep-head">
            <h1>{p.title}</h1>
            <table className="rep-details"><tbody>
              <tr><th>Client</th><td>{p.consumerName || '—'}</td><th>Assessment date</th><td>{r.date ? new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : date}</td></tr>
              <tr><th>Address</th><td>{r.address || '—'}</td><th>Funding body</th><td>{r.funding || '—'}</td></tr>
              <tr><th>Occupational therapist</th><td>{p.otName || '—'}</td><th>Organisation</th><td>{r.organisation || '—'}</td></tr>
            </tbody></table>
          </header>

          <h2>1. Reason for referral and goals</h2>
          <p>{r.goal || <span className="muted">Not recorded.</span>}</p>

          <h2>2. Wheelchair and activity</h2>
          <table className="rep-details"><tbody>
            <tr><th>Wheelchair</th><td>{C.label} – {C.width} mm wide × {C.length} mm long, turning circle ⌀{C.turn} mm</td></tr>
            <tr><th>Activity</th><td>{ACTIVITY_INFO[p.activity.type].label}{p.activity.character === 'p2' && p.activity.type === 'bed-transfer' && p.activity.bedMethod !== 'side' ? ' – ceiling hoist transfer with a carer' : p.activity.supportPerson ? ' – with a support person' : ''}</td></tr>
          </tbody></table>

          <h2>3. Findings – existing home</h2>
          <div className="two-col">
            <div><Shot k="existing" l={p.layouts.existing} route={ex.route?.samples.filter((_, i) => i % 5 === 0)} /></div>
            <div><RouteSummary built={ex} layoutKey="existing" /><RouteSummary built={pr} layoutKey="proposed" /></div>
          </div>
          <h3>Clearances</h3>
          <table className="mods clear-table"><thead><tr><th>Space</th><th>Needed</th><th>Existing</th><th>Proposed</th></tr></thead>
            <tbody>{clEx.map((c, i) => {
              const nm = c.kind === 'turn' ? `${c.room} – turning space` : c.name;
              const o = clPr.find((x) => (x.kind === 'turn' ? `${x.room} – turning space` : x.name) === nm);
              const v = (x?: Check) => (!x ? '—' : x.kind === 'turn' ? `⌀${x.max}` : `${x.clear} clear`);
              const m = (x?: Check) => (!x ? '' : x.status === 'ok' ? ' ✓' : x.status === 'tight' ? ' (tight)' : ' ✗');
              return <tr key={i}><td>{nm}</td><td>{c.kind === 'turn' ? `⌀${c.need}` : `${c.need}`}</td><td className={c.status}>{v(c)}{m(c)}</td><td className={o?.status}>{v(o)}{m(o)}</td></tr>;
            })}</tbody></table>

          <h2>4. Recommended modifications</h2>
          {r.recommendation && <p>{r.recommendation}</p>}
          {changes.length ? (
            <table className="mods"><thead><tr><th>#</th><th>Modification</th><th>Details</th></tr></thead>
              <tbody>{changes.map((c, i) => <tr key={i}><td>{i + 1}</td><th>{c.what}</th><td>{c.detail}</td></tr>)}</tbody></table>
          ) : <p>No differences between existing and proposed layouts yet.</p>}

          <h2 className="page-break">5. Proposed layout</h2>
          <p className="caveat">Dimensions in mm. Not to scale.</p>
          <MiniPlan l={p.layouts.proposed} />
          <Shot k="proposed" l={p.layouts.proposed} planIfNo3d={false} />

          {p.layouts.proposed.items.some((i) => i.kind === 'ramp' || i.kind.startsWith('grab-rail')) && (
            <>
              <h2>6. Elevations</h2>
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

          <div className="signoff"><span>Occupational therapist: ______________________</span><span>Signature: ______________________</span><span>Date: ____________</span></div>

          <h2>About this report</h2>
          <p className="caveat">
            These visualisations were created to support a shared conversation between the consumer and their occupational therapist.
            They are not a clinical assessment, building certification or a guarantee that a modification will work.
            Room measurements, door clear openings and equipment sizes must be checked on site. Recorded movements (from the original
            VisADLs motion capture) show how one person did an activity on one occasion; other movements are demonstrations made by the
            app. Neither represents how every person with a spinal cord injury moves.
          </p>
          <p className="caveat">Realistic furniture models: Amazon Berkeley Objects dataset, © Amazon.com, CC BY 4.0 (resized and compressed).</p>
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
        <h3>Credits</h3>
        <p className="muted">Realistic furniture models: Amazon Berkeley Objects dataset, © Amazon.com, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> (resized and compressed for this app). Switch them off with “Realistic furniture” in the build tools.</p>
        <div className="modal-actions"><button className="primary" onClick={() => set({ showHelp: false })}>Got it</button></div>
      </div>
    </div>
  );
};
