import { useActivity } from '../activities/useActivity';
import { useStore, type CameraPreset, type WallMode } from '../model/store';
import { Segmented, fmtTime } from './controls';

const CAMERAS: { value: CameraPreset; label: string; title: string }[] = [
  { value: 'overview', label: 'Overview', title: 'Whole room from above at an angle' },
  { value: 'top', label: 'From above', title: 'Straight down, like the floor plan' },
  { value: 'seated', label: 'Seated eye level', title: 'What the person in the wheelchair sees' },
  { value: 'support', label: 'Support person', title: 'Standing eye level' },
  { value: 'follow', label: 'Follow', title: 'Follow behind the wheelchair' },
  { value: 'closeup', label: 'Close-up', title: 'Close view of where the activity happens' },
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
        <span className="row-label">View</span>
        {CAMERAS.map((c) => (
          <button key={c.value} className={camera === c.value ? 'on' : ''} onClick={() => selectCamera(c.value)} title={c.title}>{c.label}</button>
        ))}
        <span className="spacer" />
        <span className="row-label">Walls</span>
        <Segmented<WallMode> label="Walls" value={wallMode} onChange={(wm) => set({ wallMode: wm })} options={[{ value: 'cutaway', label: 'Cut away' }, { value: 'low', label: 'Low' }, { value: 'full', label: 'Full' }]} />
        <button className={hq ? 'on' : ''} onClick={() => set({ highQuality: !hq })} title="Turn off on slower computers or tablets">{hq ? 'High quality' : 'Fast mode'}</button>
      </div>
    </div>
  );
};
