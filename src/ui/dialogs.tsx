import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

// In-app replacements for window.confirm / prompt / alert. Browser pop-ups are blocked when the
// app is embedded (e.g. hosted previews) and are awkward on tablets, so the app uses its own.

interface Pending {
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  input?: { label: string; value: string };
  resolve: (v: string | boolean | null) => void;
}

const useDialogs = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Ask a yes/no question. Resolves true if confirmed. */
export const ask = (message: string, confirmLabel = 'OK') =>
  new Promise<boolean>((resolve) => useDialogs.setState({ pending: { message, confirmLabel, cancelLabel: 'Cancel', resolve: (v) => resolve(v === true) } }));

/** Ask for a value. Resolves the text, or null if cancelled. */
export const askValue = (message: string, label: string, value: string, confirmLabel = 'OK') =>
  new Promise<string | null>((resolve) => useDialogs.setState({ pending: { message, confirmLabel, cancelLabel: 'Cancel', input: { label, value }, resolve: (v) => resolve(typeof v === 'string' ? v : null) } }));

/** Show a message. */
export const notify = (message: string) =>
  new Promise<void>((resolve) => useDialogs.setState({ pending: { message, confirmLabel: 'OK', resolve: () => resolve() } }));

export const Dialogs = () => {
  const pending = useDialogs((s) => s.pending);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pending) return;
    setValue(pending.input?.value ?? '');
    setTimeout(() => (pending.input ? inputRef.current?.select() : okRef.current?.focus()), 0);
  }, [pending]);
  if (!pending) return null;
  const close = (v: string | boolean | null) => {
    useDialogs.setState({ pending: null });
    pending.resolve(v);
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Question" onKeyDown={(e) => { if (e.key === 'Escape') close(null); }}>
      <form className="modal-card dialog" onSubmit={(e) => { e.preventDefault(); close(pending.input ? value : true); }}>
        <p className="dialog-msg">{pending.message}</p>
        {pending.input && (
          <label className="text">{pending.input.label}
            <input id="dialog-input" ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" />
          </label>
        )}
        <div className="modal-actions">
          {pending.cancelLabel && <button type="button" onClick={() => close(null)}>{pending.cancelLabel}</button>}
          <button ref={okRef} type="submit" className="primary">{pending.confirmLabel}</button>
        </div>
      </form>
    </div>
  );
};

/** True when built as a hosted web preview (no file downloads or printing available). */
export const HOSTED = import.meta.env.VITE_HOSTED === '1';
