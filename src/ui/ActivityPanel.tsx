import { ACTIVITY_INFO, P2_ID, type BuiltActivity } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { useClearances } from '../activities/useClearances';
import { DOOR_MARGIN, type Check } from '../model/clearance';
import { CHAIRS, CHAIR_PRESETS, chairOf, itemLabel } from '../model/catalogue';
import { useStore } from '../model/store';
import type { ActivityType, LayoutKey, PersonaSettings } from '../model/types';
import { NumberField, Section, Segmented, Toggle } from './controls';
import { ORIGINALS, getOriginal, loadOriginal, originalAvailable } from '../originals/originals';
import { originalRoomTemplate } from '../model/templates';
import { ask, notify } from './dialogs';

const SKIN = ['#f1d2bd', '#e0b896', '#c99a7a', '#a8775a', '#7c5238', '#53382a'];
const HAIR = ['#1f1a17', '#3b2a20', '#6b4a2e', '#a77b48', '#c9c2b8', '#8a3b22'];
const TOPS = ['#3d6e8f', '#8f3d4c', '#4d7a52', '#d9a43f', '#5a5a66', '#e9e6df'];
const BOTTOMS = ['#2f3440', '#46505e', '#5a4636', '#24262a', '#6b7b8c'];

export const RouteSummary = ({ built, layoutKey }: { built: BuiltActivity; layoutKey: LayoutKey }) => {
  const act = useStore((s) => s.project.activity);
  const unverified = useStore((s) => s.project.layouts[layoutKey].unverified);
  const r = built.route;
  if (built.problem && (!r || !built.target)) return <div className="result warn">{built.problem}</div>;
  if (!r) return null;
  const C = chairOf(act);
  const name = layoutKey === 'existing' ? 'Existing' : 'Proposed';
  const contacts = [...new Set(r.contacts.map((c) => c.with))];
  return (
    <div className={`result ${r.status}`}>
      <b>{name}: </b>
      {r.status === 'clear' && <>Clear – about <b>{Math.max(0, r.minSideClearance)} mm</b> each side at the narrowest.</>}
      {r.status === 'tight' && <>Tight{r.minSideClearance > 0 && r.minSideClearance < 999 && <> – about {r.minSideClearance} mm each side</>}.{contacts.length > 0 && <> Bumps: {contacts.join(', ')}.</>}</>}
      {r.status === 'blocked' && <>No route for a {C.width} mm chair.</>}
      {built.narrow && <div className="problem">Too narrow at {built.narrow.where}.</div>}
      {built.steps && <div className="problem">Goes over a {built.steps.join(' and a ')} – not possible in a wheelchair.</div>}
      {built.rugs && <div className="problem soft">Crosses {built.rugs > 1 ? `${built.rugs} rugs` : 'a rug'} – castors can catch on the edge.</div>}
      {built.rough && <div className="problem soft">Crosses {built.rough.join(' and ')} – hard going in a wheelchair.</div>}
      {built.problem && <div className="problem">{built.problem}</div>}
      {unverified && <div className="problem">Measurements not yet checked.</div>}
    </div>
  );
};

/** The client's wheelchair: start from a typical chair, then type in their chair's sizes. */
const ChairEditor = ({ p2 }: { p2: boolean }) => {
  const s = useStore((st) => st.project.activity);
  const update = useStore((st) => st.updateActivity);
  const C = chairOf(s);
  const preset = s.chairSpec?.preset ?? s.chair;
  const presets = CHAIR_PRESETS.filter((x) => !(p2 && x.model === 'manual'));
  const choose = (id: string) => {
    const pr = CHAIR_PRESETS.find((x) => x.id === id)!;
    update({ chair: pr.model, chairSpec: { preset: pr.id, width: pr.width, length: pr.length, turn: pr.turn } });
  };
  const edit = (k: 'width' | 'length' | 'turn', v: number) => update({ chairSpec: { preset: 'custom', width: C.width, length: C.length, turn: C.turn, [k]: v } });
  return (
    <>
      <div className="row-label">Wheelchair</div>
      <Segmented label="Wheelchair" value={preset === 'custom' ? '' : preset} onChange={choose} options={presets.map((x) => ({ value: x.id, label: x.label }))} />
      <div className="grid3">
        <NumberField label="Width" value={C.width} onChange={(v) => edit('width', v)} step={10} min={450} max={1000} />
        <NumberField label="Length" value={C.length} onChange={(v) => edit('length', v)} step={10} min={700} max={1600} />
        <NumberField label="Turning ⌀" value={C.turn} onChange={(v) => edit('turn', v)} step={50} min={1000} max={2600} />
      </div>
      {preset === 'custom' && <p className="hint">Using the client’s chair sizes.</p>}
    </>
  );
};

/** Turning space in each room and doorway widths, for the layout(s) on screen. */
const ClearanceList = () => {
  const compare = useStore((st) => st.compare);
  const active = useStore((st) => st.activeLayout);
  const ex = useClearances('existing'), pr = useClearances('proposed');
  const C = chairOf(useStore((st) => st.project.activity));
  const mark = (st: string) => (st === 'ok' ? '✓' : st === 'tight' ? '!' : '✗');
  const val = (c?: Check) => (!c ? '–' : c.kind === 'turn' ? `⌀${c.max}` : `${c.clear}`);
  const name = (c: Check) => (c.kind === 'turn' ? `${c.room} turning` : c.name);
  const cell = (c?: Check) => <span className={`st ${c?.status ?? ''}`}>{val(c)} {c ? mark(c.status) : ''}</span>;
  const base = compare ? ex : active === 'existing' ? ex : pr;
  return (
    <>
      <p className="hint">Chair {C.width} × {C.length} mm: turns in ⌀{C.turn}, doors need ≈{C.width + DOOR_MARGIN} mm clear.</p>
      <ul className="clear-list">
        {compare && <li className="head"><span /><span><span>Existing</span><span>Proposed</span></span></li>}
        {base.map((c, i) => (
          <li key={i}>
            <span>{name(c)}</span>
            {compare ? <span>{cell(c)}{cell(pr.find((x) => name(x) === name(c)))}</span> : cell(c)}
          </li>
        ))}
      </ul>
    </>
  );
};

const Swatches = ({ value, colours, onChange, label }: { value: string; colours: string[]; onChange: (c: string) => void; label: string }) => (
  <div className="swatches" role="radiogroup" aria-label={label}>
    {colours.map((c) => <button key={c} style={{ background: c }} className={value === c ? 'on' : ''} onClick={() => onChange(c)} aria-label={`${label} ${c}`} />)}
  </div>
);

export const ActivityPanel = () => {
  const s = useStore((st) => st.project.activity);
  const update = useStore((st) => st.updateActivity);
  const set = useStore((st) => st.set);
  const compare = useStore((st) => st.compare);
  const active = useStore((st) => st.activeLayout);
  const layout = useStore((st) => st.layout());
  const updateLayout = useStore((st) => st.updateLayout);
  const builtActive = useActivity(active);
  const builtOther = useActivity(active === 'existing' ? 'proposed' : 'existing');
  const persona = (p: Partial<PersonaSettings>) => update({ persona: { ...s.persona, ...p } });
  const imported = layout.items.filter((i) => i.kind === 'imported');

  const choose = (type: ActivityType) => { update({ type }); set({ time: 0, playing: false }); };
  const replaceLayout = useStore((st) => st.replaceLayout);
  const chooseOriginal = async (id: string) => {
    const o = getOriginal(id) ?? (await loadOriginal(id));
    if (!o) { notify('This recording could not be loaded.'); return; }
    update({ type: 'original', originalId: id, chair: 'power' });
    set({ time: 0, playing: false });
    if (await ask(`This recording took place in its own room (with its original bed). Load that room into the ${active} layout? You can undo this.`, 'Load the original room')) {
      replaceLayout(originalRoomTemplate(o.scene));
      useStore.getState().selectCamera('overview');
    }
  };
  const p2Ready = originalAvailable(P2_ID) && !!getOriginal(P2_ID);
  const p2 = s.character === 'p2' && p2Ready;
  const needs = ACTIVITY_INFO[s.type].needs;
  const candidates = needs ? layout.items.filter((i) => needs.includes(i.kind)) : [];
  const blurbFor = (t: ActivityType) => ACTIVITY_INFO[t].blurb;

  return (
    <div className="panel-body">
      <Section title="Choose an activity">
        <div className="activity-list" role="radiogroup" aria-label="Activity">
          {(Object.keys(ACTIVITY_INFO) as ActivityType[]).filter((t) => (t !== 'imported' || imported.length > 0) && t !== 'original').map((t) => {
            const on = s.type === t;
            const tag = p2 ? (t === 'navigate' || (t === 'bed-transfer' && s.bedMethod !== 'side') ? 'recorded' : 'demo') : null;
            return (
              <div key={t} className={`act ${on ? 'on' : ''}`}>
                <button className="act-head" role="radio" aria-checked={on} onClick={() => choose(t)}>
                  <span className="act-dot" aria-hidden />
                  <b>{ACTIVITY_INFO[t].label}</b>
                  {tag && <span className={`act-tag ${tag}`}>{tag === 'recorded' ? 'Recorded' : 'Demo'}</span>}
                </button>
                {on && (
                  <div className="act-body">
                    {blurbFor(t) && <p className="muted">{blurbFor(t)}</p>}
                    {candidates.length > 1 && (
                      <label className="select">Use which {needs![0].split('-')[0]}?
                        <select value={builtActive.target?.id} onChange={(e) => updateLayout((l) => { l.targetItemId = e.target.value; })}>
                          {candidates.map((c) => <option key={c.id} value={c.id}>{itemLabel(c.kind, c.label)} ({c.w}×{c.d})</option>)}
                        </select>
                      </label>
                    )}
                    {t === 'bed-transfer' && p2 && (
                      <>
                        <div className="row-label">Method</div>
                        <Segmented label="Bed transfer method" value={s.bedMethod ?? 'hoist'} onChange={(bedMethod) => update({ bedMethod })} options={[{ value: 'hoist', label: 'Ceiling hoist' }, { value: 'side', label: 'Side transfer' }]} />
                      </>
                    )}
                    {(t === 'bed-transfer' || t === 'toilet-transfer' || t === 'chair-transfer') && (
                      <>
                        <div className="row-label">Side</div>
                        <Segmented label="Transfer side" value={s.transferSide} onChange={(transferSide) => update({ transferSide })} options={[{ value: 'auto', label: 'Best fit' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
                        {builtActive.mh?.mirrored && <p className="hint">Shown mirrored (recorded on the other side).</p>}
                      </>
                    )}
                    {t === 'imported' && imported.length > 1 && (
                      <label className="select">Animation
                        <select value={s.importedItemId} onChange={(e) => update({ importedItemId: e.target.value })}>
                          {imported.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                        </select>
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {s.type === 'original' && (
        <Section title="About this recording">
          <p className="muted">Played exactly as recorded, in its original room.</p>
        </Section>
      )}
      {s.type !== 'imported' && s.type !== 'original' && (
        <Section title="What the route shows">
          <RouteSummary built={builtActive} layoutKey={active} />
          {compare && <RouteSummary built={builtOther} layoutKey={active === 'existing' ? 'proposed' : 'existing'} />}
          <Toggle checked={s.showSweptPath} onChange={(showSweptPath) => update({ showSweptPath })}>Show space used by the wheelchair</Toggle>
        </Section>
      )}
      {s.type !== 'original' && (
        <Section title="Clearances">
          <ClearanceList />
          <Toggle checked={s.showClearances !== false} onChange={(showClearances) => update({ showClearances })}>Show on plan and 3D</Toggle>
        </Section>
      )}

      <Section title="Person & equipment">
        <div className="row-label">Who</div>
        <Segmented label="Character" value={s.character ?? 'figure'} onChange={(character) => update(character === 'p2' ? { character, chair: 'power' } : { character })}
          options={[{ value: 'p2', label: 'Persona 2 (VisADLs)' }, { value: 'figure', label: 'Simple figure' }]} />
        {s.character === 'p2' && !p2Ready && <p className="hint">Persona 2 isn’t included in this copy.</p>}
        <ChairEditor p2={p2} />
        <Toggle checked={s.supportPerson} onChange={(supportPerson) => update({ supportPerson })}>Include a support person</Toggle>
        {!p2 && <>
        <label className="text">Name<input value={s.persona.name} onChange={(e) => persona({ name: e.target.value })} /></label>
        <NumberField label="Height" unit="cm" value={s.persona.heightCm} onChange={(heightCm) => persona({ heightCm })} step={1} min={140} max={205} />
        <div className="row-label">Skin</div><Swatches label="Skin" value={s.persona.skin} colours={SKIN} onChange={(skin) => persona({ skin })} />
        <div className="row-label">Hair</div><Swatches label="Hair" value={s.persona.hair} colours={HAIR} onChange={(hair) => persona({ hair })} />
        <div className="row-label">Top</div><Swatches label="Top" value={s.persona.top} colours={TOPS} onChange={(top) => persona({ top })} />
        <div className="row-label">Trousers</div><Swatches label="Trousers" value={s.persona.bottoms} colours={BOTTOMS} onChange={(bottoms) => persona({ bottoms })} />
        </>}
      </Section>

      {ORIGINALS.some((r) => originalAvailable(r.id)) && (
        <Section title="Original recordings" open={s.type === 'original'}>
          {ORIGINALS.filter((r) => originalAvailable(r.id)).map((r) => (
            <button key={r.id} className={`card original ${s.type === 'original' && s.originalId === r.id ? 'on' : ''}`} onClick={() => chooseOriginal(r.id)}>
              <b>★ {r.title}</b>
            </button>
          ))}
        </Section>
      )}
    </div>
  );
};
