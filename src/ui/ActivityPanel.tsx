import { ACTIVITY_INFO, type BuiltActivity } from '../activities/activities';
import { useActivity } from '../activities/useActivity';
import { CHAIRS, itemLabel } from '../model/catalogue';
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
  const chair = useStore((s) => s.project.activity.chair);
  const unverified = useStore((s) => s.project.layouts[layoutKey].unverified);
  const r = built.route;
  if (built.problem && (!r || !built.target)) return <div className="result warn">{built.problem}</div>;
  if (!r) return null;
  const C = CHAIRS[chair];
  const name = layoutKey === 'existing' ? 'Existing' : 'Proposed';
  const contacts = [...new Set(r.contacts.map((c) => c.with))];
  return (
    <div className={`result ${r.status}`}>
      <b>{name}: </b>
      {r.status === 'clear' && <>A route was found for a {C.width} mm wide chair. At its narrowest the route leaves roughly <b>{Math.max(0, r.minSideClearance)} mm</b> each side.</>}
      {r.status === 'tight' && <>The route is <b>tight</b>{r.minSideClearance < 999 && <> – roughly {Math.max(0, r.minSideClearance)} mm each side at the narrowest point</>}.{contacts.length > 0 && <> The chair outline overlaps the <b>{contacts.join(', ')}</b> (red rings) – worth discussing.</>}</>}
      {r.status === 'blocked' && <>No route could be found for a {C.width} mm wide chair. The animation shows the chair passing through obstacles so you can see where.</>}
      {built.problem && <div className="problem">⚠ {built.problem}</div>}
      {unverified && <div className="problem">⚠ Room measurements came from automatic detection and have not been checked yet.</div>}
      <div className="small">Travel takes about {r.duration.toFixed(0)} s in this animation.</div>
    </div>
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
  const needs = ACTIVITY_INFO[s.type].needs;
  const candidates = needs ? layout.items.filter((i) => needs.includes(i.kind)) : [];

  return (
    <div className="panel-body">
      <Section title="Choose an activity">
        <div className="activity-cards">
          {ORIGINALS.filter((r) => originalAvailable(r.id)).map((r) => (
            <button key={r.id} className={`card original ${s.type === 'original' && s.originalId === r.id ? 'on' : ''}`} onClick={() => chooseOriginal(r.id)}>
              <b>★ {r.title}</b>
              <span>{r.blurb}</span>
            </button>
          ))}
          {(Object.keys(ACTIVITY_INFO) as ActivityType[]).filter((t) => (t !== 'imported' || imported.length > 0) && t !== 'original').map((t) => (
            <button key={t} className={`card ${s.type === t ? 'on' : ''}`} onClick={() => choose(t)}>
              <b>{ACTIVITY_INFO[t].label}</b>
              <span>{ACTIVITY_INFO[t].blurb}</span>
            </button>
          ))}
        </div>
        {candidates.length > 1 && (
          <label className="select">Use which {needs![0].split('-')[0]}?
            <select value={builtActive.target?.id} onChange={(e) => updateLayout((l) => { l.targetItemId = e.target.value; })}>
              {candidates.map((c) => <option key={c.id} value={c.id}>{itemLabel(c.kind, c.label)} ({c.w}×{c.d})</option>)}
            </select>
          </label>
        )}
        {(s.type === 'bed-transfer' || s.type === 'toilet-transfer') && (
          <>
            <div className="row-label">Transfer from which side?</div>
            <Segmented label="Transfer side" value={s.transferSide} onChange={(transferSide) => update({ transferSide })} options={[{ value: 'auto', label: 'Best fit' }, { value: 'left', label: 'Left side' }, { value: 'right', label: 'Right side' }]} />
            <p className="hint">Left/right as you face the {s.type === 'bed-transfer' ? 'foot of the bed' : 'front of the toilet'}.{s.transferSide === 'auto' && builtActive.side && <> Using the <b>{builtActive.side}</b> side.</>} The orange dashed outline on the plan shows where the chair parks.</p>
          </>
        )}
        {s.type === 'imported' && imported.length > 1 && (
          <label className="select">Animation
            <select value={s.importedItemId} onChange={(e) => update({ importedItemId: e.target.value })}>
              {imported.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>
        )}
      </Section>

      {s.type === 'original' && (
        <Section title="About this recording">
          <p className="muted">This is real motion capture from the original VisADLs project, played on the MetaHumans used in the study. The person's and carer's movements, the hoist bar and the wheelchair's path and turning are as recorded; the wheelchair is shown with the app's own powered-chair model. Skin and clothing colours are placeholders until the original textures are exported.</p>
          <p className="caveat">A recording shows how one person performed this activity on one occasion. It is not a prediction of how anyone else would move.</p>
        </Section>
      )}
      {s.type !== 'imported' && s.type !== 'original' && (
        <Section title="What the route shows">
          <RouteSummary built={builtActive} layoutKey={active} />
          {compare && <RouteSummary built={builtOther} layoutKey={active === 'existing' ? 'proposed' : 'existing'} />}
          <Toggle checked={s.showSweptPath} onChange={(showSweptPath) => update({ showSweptPath })}>Show space used by the wheelchair</Toggle>
          <p className="caveat">This is a visual guide to support discussion. It is not a clinical assessment or a guarantee that a design will work. The route is calculated automatically and real movement varies from person to person.</p>
        </Section>
      )}

      <Section title="Person & equipment">
        <div className="row-label">Wheelchair</div>
        <Segmented label="Wheelchair" value={s.chair} onChange={(chair) => update({ chair })} options={[{ value: 'manual', label: 'Manual' }, { value: 'power', label: 'Powered' }]} />
        <p className="muted">{CHAIRS[s.chair].label}: {CHAIRS[s.chair].width} wide × {CHAIRS[s.chair].length} long, seat {CHAIRS[s.chair].seatHeight} mm.</p>
        <Toggle checked={s.supportPerson} onChange={(supportPerson) => update({ supportPerson })}>Include a support person</Toggle>
        <label className="text">Name<input value={s.persona.name} onChange={(e) => persona({ name: e.target.value })} /></label>
        <NumberField label="Height" unit="cm" value={s.persona.heightCm} onChange={(heightCm) => persona({ heightCm })} step={1} min={140} max={205} />
        <div className="row-label">Skin</div><Swatches label="Skin" value={s.persona.skin} colours={SKIN} onChange={(skin) => persona({ skin })} />
        <div className="row-label">Hair</div><Swatches label="Hair" value={s.persona.hair} colours={HAIR} onChange={(hair) => persona({ hair })} />
        <div className="row-label">Top</div><Swatches label="Top" value={s.persona.top} colours={TOPS} onChange={(top) => persona({ top })} />
        <div className="row-label">Trousers</div><Swatches label="Trousers" value={s.persona.bottoms} colours={BOTTOMS} onChange={(bottoms) => persona({ bottoms })} />
        <p className="caveat">The movements shown are illustrative placeholders. Authentic motion-capture sequences (e.g. from the original VisADLs project) can be imported as animated models. A recorded sequence shows one person’s way of doing an activity, not how everyone moves.</p>
      </Section>
    </div>
  );
};
