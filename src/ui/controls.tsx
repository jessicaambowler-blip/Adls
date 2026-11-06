import { useEffect, useState, type ReactNode } from 'react';

export const NumberField = ({
  label, value, onChange, step = 10, min, max, unit = 'mm', help,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; help?: string }) => {
  const [text, setText] = useState(String(Math.round(value)));
  useEffect(() => setText(String(Math.round(value))), [value]);
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(String(Math.round(value)));
  };
  return (
    <label className="numfield">
      <span className="nf-label">{label}{help && <small>{help}</small>}</span>
      <span className="nf-row">
        <button type="button" onClick={() => onChange(clamp(value - step))} aria-label={`Decrease ${label}`}>−</button>
        <input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
          aria-label={label}
        />
        <span className="unit">{unit}</span>
        <button type="button" onClick={() => onChange(clamp(value + step))} aria-label={`Increase ${label}`}>+</button>
      </span>
    </label>
  );
};

export const Segmented = <T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label?: string }) => (
  <div className="segmented" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title}>
        {o.label}
      </button>
    ))}
  </div>
);

export const Toggle = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="track"><span className="thumb" /></span>
    <span>{children}</span>
  </label>
);

export const Section = ({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) => (
  <details className="section" open={open}>
    <summary>{title}</summary>
    <div className="section-body">{children}</div>
  </details>
);

export const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
