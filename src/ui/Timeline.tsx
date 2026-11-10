import { useActivity } from '../activities/useActivity';
import { useStore, type CameraPreset, type WallMode } from '../model/store';
import { Segmented, fmtTime } from './controls';

const CAMERAS: { value: CameraPreset; label: string; title: string }[] = [
  { value: 'overview', label: 'Overview', title: 'Whole room from above at an angle' },
  { value: 'top', label: 'Top', title: 'Straight down, like the floor plan' },
  { value: 'seated', label: 'Seated', title: 'What the person in the wheelchair sees' },
  { value: 'support', label: 'Carer', title: 'Standing eye level' },
  { value: 'follow', label: 'Follow', title: 'Follow behind the wheelchair' },
  { value: 'closeup', label: 'Close-up', title: 'Close view that follows the person' },
  { value: 'free', label: 'Walk', title: 'Move freely: W A S D or arrow keys to move, Q / E to turn, R / F up and down, Shift to go faster. Drag to look around.' },
];

export const Timeline = () => {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const duration = useStore((s) => s.duration);
  const speed = useStore((s) => s.speed);
  const set = useStore((s) => s.set);
  const camera = useStore((s) => s.camera);
  const selectCamera = useStore((s) => s.selectCamera);
  const wallMode = useStore((s) => s.wallMode);
  const hq = useStore((s) => s.highQuality);
  const labels = useStore((s) => s.showLabels);
  const active = useStore((s) => s.activeLayout);
  const built = useActivity(active);

  const toggle = () => {
    if (!playing && time >= duration - 0.01) set({ time: 0, playing: true });
    else set({ playing: !playing });
  };

  return (
    <div className="timeline" role="group" aria-label="Activity playback">
      <div className="tl-row">
        <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <button onClick={() => set({ time: 0, playing: false })} aria-label="Back to start">⏮</button>
        <button onClick={() => set({ time: Math.max(0, time - 0.5), playing: false })} aria-label="Step back">−½s</button>
        <button onClick={() => set({ time: Math.min(duration, time + 0.5), playing: false })} aria-label="Step forward">+½s</button>
        <div className="scrub">
          <input
            type="range" min={0} max={duration} step={0.01} value={Math.min(time, duration)}
            onChange={(e) => set({ time: +e.target.value, playing: false })}
            aria-label="Timeline"
          />
          <div className="phases">
            {built.phases.map((p) => (
              <button key={p.label + p.t} style={{ left: `${(p.t / duration) * 100}%` }} onClick={() => set({ time: p.t + 0.01, playing: false })} title={`Jump to: ${p.label}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <span className="time">{fmtTime(time)} / {fmtTime(duration)}</span>
        <Segmented label="Speed" value={String(speed)} onChange={(v) => set({ speed: +v })} options={[{ value: '0.5', label: '½×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '4', label: '4×' }]} />
      </div>
      <div className="tl-row cams">
        <div className="segmented" role="radiogroup" aria-label="View">
          {CAMERAS.map((c) => (
            <button key={c.value} role="radio" aria-checked={camera === c.value} className={camera === c.value ? 'on' : ''} onClick={() => selectCamera(c.value)} title={c.title}>{c.label}</button>
          ))}
        </div>
        <span className="spacer" />
        <Segmented<WallMode> label="Walls" value={wallMode} onChange={(wm) => set({ wallMode: wm })} options={[{ value: 'cutaway', label: 'Cut away' }, { value: 'low', label: 'Low walls' }, { value: 'full', label: 'Full' }]} />
        <button className={`icon-toggle ${labels ? 'on' : ''}`} onClick={() => toggleLabels()} title={labels ? 'Hide labels' : 'Show labels'} aria-pressed={labels}>Aa</button>
        <button className={`icon-toggle ${hq ? 'on' : ''}`} onClick={() => set({ highQuality: !hq })} title={hq ? 'High quality (turn off on slower devices)' : 'Fast mode'} aria-pressed={hq}>HQ</button>
      </div>
    </div>
  );
};

/** Show or hide labels everywhere, and remember the choice in this browser. */
export const toggleLabels = () => {
  const on = !useStore.getState().showLabels;
  useStore.getState().set({ showLabels: on });
  try { localStorage.setItem('visadls-labels', on ? 'on' : 'off'); } catch { /* private browsing */ }
};
