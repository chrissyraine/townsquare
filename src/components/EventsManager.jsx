import { useState, useEffect } from 'react';

const BLANK = {
  title: '', starts_at: '', ends_at: '', location: '', description: '', is_kids: false,
  audience: '', age_range: '', category: '', cost: '', registration_required: false,
  registration_link: '', contact_info: '', image: '', accessibility_notes: '',
};

// Owner-facing event CRUD against TownSquare's own town_events table
// (/api/business/events*) — separate from the admin-only /api/square/events
// moderation queue. STAFF sessions get a read-only list (events aren't in
// their permitted daily-update set, per the role spec).
export default function EventsManager({ business }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(null); // null = list view, object = editor open
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const readOnly = business?.role === 'STAFF';

  const load = () => {
    fetch('/api/business/events', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEvents((d && d.events) || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const startCreate = () => setForm({ ...BLANK });
  const startEdit = (ev) => setForm({ ...BLANK, ...ev, is_kids: !!ev.is_kids, registration_required: !!ev.registration_required });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const isEdit = !!form.id;
      const res = await fetch(isEdit ? `/api/business/events/${form.id}` : '/api/business/events', {
        method: isEdit ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setForm(null);
        load();
      } else {
        setMessage({ type: 'error', text: data.error || 'Could not save that event.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const publish = async (id) => {
    const res = await fetch(`/api/business/events/${id}/publish`, { method: 'POST', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMessage({ type: 'error', text: data.detail || data.error || 'Could not publish.' });
    load();
  };
  const cancelEvent = async (id) => {
    if (!window.confirm('Cancel this event? It will stay visible to the public, marked as canceled.')) return;
    await fetch(`/api/business/events/${id}/cancel`, { method: 'POST', credentials: 'same-origin' });
    load();
  };
  const deleteDraft = async (id) => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    await fetch(`/api/business/events/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    load();
  };

  if (loading) return <div className="animate-fade-in">Loading your events…</div>;

  if (form) {
    return (
      <div className="animate-fade-in" style={{ maxWidth: '820px' }}>
        <header style={{ marginBottom: '1.5rem' }}>
          <div className="eyebrow">Events</div>
          <h2>{form.id ? 'Edit Event' : 'Add Event'}</h2>
        </header>
        <form onSubmit={save}>
          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <Field label="Title" value={form.title} onChange={(v) => set('title', v)} required />
              <Field label="Starts (YYYY-MM-DD HH:MM)" value={form.starts_at} onChange={(v) => set('starts_at', v)} placeholder="2026-08-01 18:00" required />
              <Field label="Ends (optional)" value={form.ends_at} onChange={(v) => set('ends_at', v)} placeholder="2026-08-01 20:00" />
              <Field label="Location" value={form.location} onChange={(v) => set('location', v)} />
              <Field label="Category" value={form.category} onChange={(v) => set('category', v)} placeholder="music, market, class…" />
              <Field label="Cost" value={form.cost} onChange={(v) => set('cost', v)} placeholder="Free, $10, $5-15…" />
              <Field label="Audience" value={form.audience} onChange={(v) => set('audience', v)} placeholder="families, adults 21+…" />
              <Field label="Age range" value={form.age_range} onChange={(v) => set('age_range', v)} />
              <Field label="Contact info" value={form.contact_info} onChange={(v) => set('contact_info', v)} />
              <Field label="Image URL" value={form.image} onChange={(v) => set('image', v)} />
            </div>
            <TextArea label="Description" value={form.description} onChange={(v) => set('description', v)} style={{ marginTop: '16px' }} />
            <TextArea label="Accessibility notes" value={form.accessibility_notes} onChange={(v) => set('accessibility_notes', v)} style={{ marginTop: '16px' }} rows={2} />
            <div style={{ display: 'flex', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}>
                <input type="checkbox" checked={form.is_kids} onChange={(e) => set('is_kids', e.target.checked)} /> Kid/family-friendly
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}>
                <input type="checkbox" checked={form.registration_required} onChange={(e) => set('registration_required', e.target.checked)} /> Registration required
              </label>
            </div>
            {form.registration_required && (
              <Field label="Registration link" value={form.registration_link} onChange={(v) => set('registration_link', v)} style={{ marginTop: '16px' }} />
            )}
          </section>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
            {message && <span style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{message.text}</span>}
            <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Event'}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: '1180px' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="eyebrow">My Business</div>
          <h2>Events</h2>
          <p style={{ color: 'var(--text-muted)' }}>Submit events to the community calendar on Titusville Square.</p>
        </div>
        {!readOnly && <button type="button" className="btn btn-primary" onClick={startCreate}>Add Event</button>}
      </header>

      {message && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '16px' }}>{message.text}</div>}

      {events.length === 0 ? (
        <div className="glass-panel" style={{ padding: '32px', color: 'var(--text-muted)' }}>
          No upcoming events yet. Add one to the community calendar.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
          {events.map((ev) => (
            <div key={ev.id} className="glass-panel" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.95rem', color: 'var(--text-soft)' }}>
                  {ev.title}{' '}
                  <StatusBadge ev={ev} />
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{ev.starts_at}{ev.location ? ` · ${ev.location}` : ''}</div>
              </div>
              {!readOnly && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} onClick={() => startEdit(ev)}>Edit</button>
                  {!ev.is_published && !ev.is_canceled && (
                    <button type="button" className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} onClick={() => publish(ev.id)}>
                      {ev.moderation_required ? 'Submit for approval' : 'Publish'}
                    </button>
                  )}
                  {!!ev.is_published && !ev.is_canceled && (
                    <button type="button" className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} onClick={() => cancelEvent(ev.id)}>Cancel</button>
                  )}
                  {!ev.is_published && (
                    <button type="button" onClick={() => deleteDraft(ev.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Delete</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ ev }) {
  const label = ev.is_canceled ? 'Canceled' : ev.is_published ? 'Published' : ev.moderation_required ? 'Pending approval' : 'Draft';
  const color = ev.is_canceled ? 'var(--danger)' : ev.is_published ? 'var(--success)' : 'var(--text-muted)';
  return <span style={{ fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color, border: `1px solid ${color}`, borderRadius: '3px', padding: '1px 8px', marginLeft: '8px' }}>{label}</span>;
}

function Field({ label, value, onChange, required, placeholder, style }) {
  return (
    <div className="input-group" style={{ marginBottom: 0, ...style }}>
      <label className="input-label">{label}</label>
      <input className="input-field" type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} />
    </div>
  );
}
function TextArea({ label, value, onChange, rows = 3, style }) {
  return (
    <div className="input-group" style={{ marginBottom: 0, ...style }}>
      <label className="input-label">{label}</label>
      <textarea className="input-field" rows={rows} value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ resize: 'vertical' }} />
    </div>
  );
}
