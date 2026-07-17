import { useState, useEffect } from 'react';

// Routed through the TownSquare proxy to Herald, which owns the actual hours
// data (weekly schedule + dated exceptions) — see project-architecture.md and
// migrate-add-hours-exceptions.sql. This component is UI/UX only; it does not
// store hours anywhere in TownSquare's own database, so there is exactly one
// source of truth for "what are this business's hours."
const HERALD_API = '/api/m/herald';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const BLANK_WEEK = Array.from({ length: 7 }, (_, d) => ({
  day_of_week: d, open_time: '', close_time: '', is_closed: false, is_24h: false, appointment_only: false,
}));

export default function HoursManager({ business }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [week, setWeek] = useState(BLANK_WEEK);
  const [exceptions, setExceptions] = useState([]);
  const [newException, setNewException] = useState({ date: '', status: 'closed', open_time: '', close_time: '', note: '' });

  const [override, setOverride] = useState({ active: false, status: 'closed', note: '' });
  const [overrideSaving, setOverrideSaving] = useState(false);

  const readOnly = business?.role === 'STAFF'; // weekly schedule / exceptions are MANAGER+; today's override stays STAFF+

  useEffect(() => {
    Promise.all([
      fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/week`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/exceptions`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${HERALD_API}/api/public/businesses/${business.slug}/feed`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([w, ex, feed]) => {
      if (w && Array.isArray(w.week)) setWeek(w.week);
      if (ex && Array.isArray(ex.exceptions)) setExceptions(ex.exceptions);
      if (feed && feed.hours && (feed.hours.status === 'closed' || feed.hours.status === 'open_special')) {
        setOverride({ active: true, status: feed.hours.status, note: feed.hours.note || '' });
      }
    }).finally(() => setLoading(false));
  }, [business.slug]);

  const setDay = (idx, patch) => setWeek((w) => w.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  const saveWeek = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/week`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week }),
      });
      setMessage(res.ok ? { type: 'success', text: 'Weekly hours saved.' } : { type: 'error', text: 'Could not save. Please try again.' });
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const addException = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newException.date)) {
      setMessage({ type: 'error', text: 'Choose a date first.' });
      return;
    }
    const res = await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/exceptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newException),
    });
    if (res.ok) {
      const r = await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/exceptions`);
      if (r.ok) { const d = await r.json(); setExceptions(d.exceptions || []); }
      setNewException({ date: '', status: 'closed', open_time: '', close_time: '', note: '' });
    } else {
      setMessage({ type: 'error', text: 'Could not save that date.' });
    }
  };

  const deleteException = async (date) => {
    await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/exceptions/${date}`, { method: 'DELETE' });
    setExceptions((ex) => ex.filter((e) => e.exception_date !== date));
  };

  const saveOverride = async (e) => {
    e.preventDefault();
    setOverrideSaving(true);
    try {
      await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      });
      setMessage({ type: 'success', text: 'Today’s status updated.' });
    } catch {
      setMessage({ type: 'error', text: 'Could not save. Please try again.' });
    } finally {
      setOverrideSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (!business?.modules?.herald) {
    return (
      <div className="animate-fade-in" style={{ maxWidth: '640px' }}>
        <div className="eyebrow">My Business</div>
        <h2>Hours</h2>
        <div className="glass-panel" style={{ padding: '32px', marginTop: '16px' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
            Hours are managed through The Herald, which isn't set up for your business yet.
            Add it to start setting your weekly hours and today's status.
          </p>
          <button className="btn btn-primary" onClick={() => alert("We'll set up The Herald for your business. (Onboarding flow comes in a later phase.)")}>
            Add The Herald to my TownSquare
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="animate-fade-in">Loading your hours…</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '820px' }}>
      <header style={{ marginBottom: '2rem' }}>
        <div className="eyebrow">My Business</div>
        <h2>Hours</h2>
        <p style={{ color: 'var(--text-muted)' }}>What customers see as your open/closed status on Titusville Square.</p>
      </header>

      {/* Closing early / opening late today */}
      <form onSubmit={saveOverride}>
        <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Today's Status</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            Override your regular hours just for today — closing early, a surprise closure, unexpected special hours.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem', marginBottom: '16px' }}>
            <input type="checkbox" checked={override.active} onChange={(e) => setOverride({ ...override, active: e.target.checked })} style={{ accentColor: 'var(--accent-primary)' }} />
            Override regular hours today
          </label>
          {override.active && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={override.status} onChange={(e) => setOverride({ ...override, status: e.target.value })}>
                  <option value="closed">Closed today</option>
                  <option value="open_special">Special hours</option>
                </select>
              </div>
              <div className="input-group" style={{ flex: 2, minWidth: 200, marginBottom: 0 }}>
                <label className="input-label">Public note (optional)</label>
                <input className="input-field" type="text" value={override.note} onChange={(e) => setOverride({ ...override, note: e.target.value })} placeholder="e.g. Closing early for a private event" />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="submit" className="btn btn-primary" disabled={overrideSaving}>{overrideSaving ? 'Saving…' : 'Save Today’s Status'}</button>
          </div>
        </section>
      </form>

      {readOnly && (
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          You have view-only access to the weekly schedule and special dates. Ask an owner or manager to make changes.
        </div>
      )}

      {/* Weekly hours */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Weekly Hours</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {week.map((d, i) => (
            <div key={d.day_of_week} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ width: 96, fontSize: '0.85rem', color: 'var(--text-soft)' }}>{DAY_NAMES[d.day_of_week]}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <input type="checkbox" disabled={readOnly} checked={d.is_closed} onChange={(e) => setDay(i, { is_closed: e.target.checked })} /> Closed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <input type="checkbox" disabled={readOnly} checked={d.is_24h} onChange={(e) => setDay(i, { is_24h: e.target.checked })} /> Open 24h
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <input type="checkbox" disabled={readOnly} checked={d.appointment_only} onChange={(e) => setDay(i, { appointment_only: e.target.checked })} /> Appointment only
              </label>
              {!d.is_closed && !d.is_24h && (
                <>
                  <input className="input-field" type="time" disabled={readOnly} value={d.open_time || ''} onChange={(e) => setDay(i, { open_time: e.target.value })} style={{ width: 130 }} />
                  <span style={{ color: 'var(--text-muted)' }}>–</span>
                  <input className="input-field" type="time" disabled={readOnly} value={d.close_time || ''} onChange={(e) => setDay(i, { close_time: e.target.value })} style={{ width: 130 }} />
                </>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', marginTop: '20px' }}>
            {message && <span style={{ color: message.type === 'error' ? 'var(--danger)' : 'var(--success)', fontSize: '0.875rem' }}>{message.text}</span>}
            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveWeek}>{saving ? 'Saving…' : 'Save Weekly Hours'}</button>
          </div>
        )}
      </section>

      {/* Special / holiday hours */}
      <section className="glass-panel" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Special &amp; Holiday Hours</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
          Schedule a change for a specific future date — a holiday closure, a one-day special hours.
        </p>
        {exceptions.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>No upcoming special dates yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            {exceptions.map((ex) => (
              <div key={ex.exception_date} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-soft)' }}>
                  {ex.exception_date} — {ex.status.replace('_', ' ')}{ex.note ? ` (${ex.note})` : ''}
                </span>
                {!readOnly && <button type="button" onClick={() => deleteException(ex.exception_date)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Remove</button>}
              </div>
            ))}
          </div>
        )}
        {!readOnly && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Date</label>
              <input className="input-field" type="date" value={newException.date} onChange={(e) => setNewException({ ...newException, date: e.target.value })} />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Status</label>
              <select className="input-field" value={newException.status} onChange={(e) => setNewException({ ...newException, status: e.target.value })}>
                <option value="closed">Closed</option>
                <option value="open_special">Special hours</option>
                <option value="open_24h">Open 24 hours</option>
                <option value="appointment_only">Appointment only</option>
              </select>
            </div>
            {newException.status === 'open_special' && (
              <>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Open</label>
                  <input className="input-field" type="time" value={newException.open_time} onChange={(e) => setNewException({ ...newException, open_time: e.target.value })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Close</label>
                  <input className="input-field" type="time" value={newException.close_time} onChange={(e) => setNewException({ ...newException, close_time: e.target.value })} />
                </div>
              </>
            )}
            <div className="input-group" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
              <label className="input-label">Note (optional)</label>
              <input className="input-field" type="text" value={newException.note} onChange={(e) => setNewException({ ...newException, note: e.target.value })} placeholder="e.g. Closed for Thanksgiving" />
            </div>
            <button type="button" className="btn btn-primary" onClick={addException}>Add Date</button>
          </div>
        )}
      </section>
    </div>
  );
}
