import { useEffect, useState } from 'react';
import { ACTIVITY_INFO } from '../activities/activities';
import { uid } from '../model/geometry';
import { useStore } from '../model/store';
import type { Note, NoteCategory } from '../model/types';
import { Segmented, fmtTime } from './controls';

export const CATEGORIES: { value: NoteCategory; label: string }[] = [
  { value: 'concern', label: 'Concern' },
  { value: 'preference', label: 'Preference' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
  { value: 'decision', label: 'Decision' },
];

export const NotesPanel = () => {
  const notes = useStore((s) => s.project.notes);
  const addNote = useStore((s) => s.addNote);
  const removeNote = useStore((s) => s.removeNote);
  const updateNote = useStore((s) => s.updateNote);
  const set = useStore((s) => s.set);
  const pendingPin = useStore((s) => s.pendingPin);
  const active = useStore((s) => s.activeLayout);
  const activity = useStore((s) => s.project.activity.type);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<NoteCategory>('concern');
  const [author, setAuthor] = useState<Note['author']>('consumer');

  useEffect(() => {
    if (pendingPin) document.getElementById('note-text')?.focus();
  }, [pendingPin]);

  const save = () => {
    if (!text.trim()) return;
    addNote({
      id: uid('note'), text: text.trim(), category, author, layout: active, activity,
      time: useStore.getState().time, pin: pendingPin, createdAt: new Date().toISOString(),
    });
    setText('');
    set({ pendingPin: undefined });
  };

  return (
    <div className="panel-body">
      <div className="note-form">
        <label htmlFor="note-text" className="row-label">Add a note about what you can see right now</label>
        <textarea id="note-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Footplate comes close to the bedside table when turning" />
        <Segmented label="Type of note" value={category} onChange={setCategory} options={CATEGORIES} />
        <div className="row-label">Who raised it?</div>
        <Segmented label="Author" value={author} onChange={setAuthor} options={[{ value: 'consumer', label: 'Consumer' }, { value: 'ot', label: 'OT' }, { value: 'other', label: 'Other' }]} />
        <div className="btnrow">
          <button onClick={() => set({ tool: 'pin-note' })}>{pendingPin ? '📍 Pinned – move pin' : '📍 Pin to plan'}</button>
          {pendingPin && <button onClick={() => set({ pendingPin: undefined })}>Unpin</button>}
          <button className="primary" onClick={save} disabled={!text.trim()}>Save note</button>
        </div>
        <p className="hint">Notes remember the layout ({active}), the activity and the moment in the animation, so you can jump back to them.</p>
      </div>

      <h3 className="list-title">Notes ({notes.length})</h3>
      {notes.length === 0 && <p className="muted">No notes yet.</p>}
      <ol className="notes">
        {notes.map((n) => (
          <li key={n.id} className={`note ${n.category}`}>
            <div className="note-head">
              <span className={`badge ${n.category}`}>{n.category}</span>
              <span className={`lk ${n.layout}`}>{n.layout}</span>
              <span className="muted">{n.author === 'ot' ? 'OT' : n.author}</span>
              {n.pin && <span title="Pinned on plan">📍</span>}
            </div>
            <textarea className="note-text" value={n.text} rows={2} onChange={(e) => updateNote(n.id, { text: e.target.value })} aria-label="Note text" />
            <div className="btnrow small">
              <button onClick={() => {
                useStore.getState().updateActivity({ type: n.activity });
                set({ activeLayout: n.layout, time: n.time, playing: false });
              }}>▶ Go to {fmtTime(n.time)} · {ACTIVITY_INFO[n.activity].label}</button>
              <button className="danger" onClick={() => removeNote(n.id)} aria-label="Delete note">Delete</button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};
