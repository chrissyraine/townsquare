import { useState, useEffect } from 'react';
import { MODULES } from './moduleRegistry';

// Owner dashboard home. Assembles real data from three endpoints — no invented
// stats, no filler. Empty states are honest ("Nothing posted yet") rather than
// blank panels, per the product spec.
export default function DashboardHome({ business, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [home, setHome] = useState(null);
  const [preview, setPreview] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/business/home', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/business/preview', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/business/events', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([h, p, e]) => {
      if (cancelled) return;
      setHome(h);
      setPreview(p);
      setEvents((e && e.events) || []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="animate-fade-in">Loading your dashboard…</div>;

  const modules = business?.modules || {};
  const upcoming = events
    .filter((ev) => !ev.is_canceled && ev.is_published)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 3);

  const hours = home?.today?.hours;
  const announcement = home?.today?.announcement;
  const hoursLine = !hours || hours.status === 'unknown'
    ? 'Not set yet'
    : hours.status === 'open' ? `Open · ${hours.open_time || ''}–${hours.close_time || ''}`
    : hours.status === 'closed' ? `Closed today${hours.note ? ` — ${hours.note}` : ''}`
    : hours.status === 'open_special' ? `Special hours today${hours.note ? ` — ${hours.note}` : ''}`
    : hours.status === 'open_24h' ? 'Open 24 hours'
    : hours.status === 'appointment_only' ? 'By appointment only'
    : hours.status;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '960px' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <div className="eyebrow">Home</div>
        <h2>Good {timeOfDay()}{business?.userName ? `, ${business.userName.split(' ')[0]}` : ''}.</h2>
        <p style={{ color: 'var(--text-muted)' }}>Here's what's happening with {business?.name} today.</p>
      </header>

      {/* TODAY */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Today</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '18px' }}>
          <TodayItem label="Hours" value={hoursLine} onClick={() => onNavigate('hours')} />
          <TodayItem label="Announcement" value={announcement && announcement.text ? announcement.text : 'Nothing posted right now'} onClick={() => onNavigate('herald')} />
          <TodayItem label="Public listing" value={preview?.is_public ? 'Visible on Titusville Square' : 'Hidden from the public directory'} onClick={() => onNavigate('preview')} />
          <TodayItem label="Events today" value={upcoming.filter((e) => e.starts_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length ? 'Yes — see below' : 'None today'} onClick={() => onNavigate('events')} />
        </div>
      </section>

      {/* NEEDS YOUR ATTENTION */}
      {home?.needs_attention?.length > 0 && (
        <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Needs your attention</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {home.needs_attention.map((item) => (
              <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-soft)' }}>{item.message}</span>
                <button type="button" className="btn btn-outline" style={{ padding: '8px 18px', fontSize: '9px', whiteSpace: 'nowrap' }} onClick={() => onNavigate(item.action)}>Fix it</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* QUICK ACTIONS */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Quick actions</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate('hours')}>Update hours</button>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('herald')}>Post announcement</button>
          {modules.drawbridge && <button type="button" className="btn btn-outline" onClick={() => onNavigate('drawbridge')}>Add a special</button>}
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('events')}>Add event</button>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('profile')}>Edit business profile</button>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('preview')}>Preview my listing</button>
        </div>
      </section>

      <div className="ts-dash-grid">
        {/* UPCOMING CONTENT */}
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Upcoming events</h3>
          {upcoming.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No upcoming events yet. Add one to the community calendar.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {upcoming.map((ev) => (
                <div key={ev.id} style={{ fontSize: '0.875rem' }}>
                  <div style={{ color: 'var(--text-soft)' }}>{ev.title}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{ev.starts_at}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* YOUR TOOLS */}
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Your tools</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {MODULES.map((m) => {
              const enrolled = !!modules[m.key];
              return (
                <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.875rem', color: enrolled ? 'var(--text-soft)' : 'var(--text-muted)' }}>{m.label}</span>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ padding: '6px 14px', fontSize: '9px' }}
                    onClick={() => (m.external ? window.open(m.url, '_blank') : onNavigate(m.key))}
                  >
                    {enrolled || m.external ? 'Open' : 'Setup Needed'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* RECENT ACTIVITY */}
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Recent activity</h3>
          {(!home?.recent_activity || home.recent_activity.length === 0) ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Nothing yet — changes you make will show up here.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {home.recent_activity.map((a) => (
                <div key={a.id} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-soft)' }}>{describeActivity(a)}</span>
                  {' · '}{formatWhen(a.created_at)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TodayItem({ label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
      <div style={{ fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-primary)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)' }}>{value}</div>
    </button>
  );
}

function timeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

const ACTIVITY_LABELS = {
  login: 'Signed in',
  profile_updated: 'Business profile updated',
  event_created: 'Event created',
  event_published: 'Event published',
  event_canceled: 'Event canceled',
  event_deleted: 'Event deleted',
  team_invited: 'Team invitation sent',
  team_role_changed: 'Team role changed',
  team_removed: 'Team member removed',
};
function describeActivity(a) {
  return ACTIVITY_LABELS[a.type] || a.type;
}
function formatWhen(iso) {
  try { return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(); } catch { return iso; }
}
