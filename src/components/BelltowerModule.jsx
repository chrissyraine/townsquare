import { useState, useEffect } from 'react';

// Routed through the TownSquare proxy; the worker mints a Belfry-scoped token
// server-side. No tokens in the browser.
const BELLTOWER_API = '/api/m/belltower';
// The ICS feed is subscribed externally (phone/Google calendar), so it must be
// the real public origin — NOT the cookie-auth proxy.
const BELLTOWER_PUBLIC = 'https://getbelltower.app';

export default function BelltowerModule({ business }) {
  const [loading, setLoading] = useState(true);

  // State from API
  const [isAccepting, setIsAccepting] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [blackouts, setBlackouts] = useState([]);
  const [calendarToken, setCalendarToken] = useState(null);
  const [notifyEmail, setNotifyEmail] = useState('');

  // Block off time form
  const [blockDate, setBlockDate] = useState('');
  const [blockFrom, setBlockFrom] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [blockReason, setBlockReason] = useState('');

  // Alerts form
  const [draftEmail, setDraftEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);

  const fetchState = async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/state`, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setIsAccepting(data.is_accepting);
        setCalendarToken(data.calendar_token);
        setNotifyEmail(data.notify_email || '');
        setDraftEmail(data.notify_email || '');
        setBlackouts(data.blackouts || []);
      } else {
        setErrorMsg(`API Error: ${res.status} ${res.statusText}`);
      }

      const today = new Date().toISOString().split('T')[0];
      const bookingsRes = await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/bookings?from=${today}`, { credentials: 'same-origin' });
      if (bookingsRes.ok) {
        const bData = await bookingsRes.json();
        setBookings(bData.bookings || []);
      }
    } catch (err) {
      console.error("Failed to load Belltower state", err);
      setErrorMsg(err.toString());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [business.slug]);

  const handleToggleAccepting = async (active) => {
    setIsAccepting(active);
    await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/accepting`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ is_accepting: active, closed_message: "Currently not accepting bookings." })
    });
  };

  const handleAddBlock = async (e) => {
    e.preventDefault();
    if (!blockDate || !blockFrom || !blockTo) return;

    const start_at = `${blockDate} ${blockFrom}`;
    const end_at = `${blockDate} ${blockTo}`;

    try {
      const res = await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/blackouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ start_at, end_at, reason: blockReason })
      });

      if (res.ok) {
        setBlockDate('');
        setBlockFrom('');
        setBlockTo('');
        setBlockReason('');
        fetchState();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveBlock = async (id) => {
    setBlackouts(blackouts.filter(b => b.id !== id));
    await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/blackouts/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  };

  const handleSaveEmail = async (e) => {
    e.preventDefault();
    await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/notify-email`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: draftEmail })
    });
    setNotifyEmail(draftEmail);
  };

  const handleGenerateLink = async () => {
    const res = await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/calendar-token`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    if (res.ok) {
      const data = await res.json();
      setCalendarToken(data.calendar_token);
      alert('New calendar link generated!');
    }
  };

  if (loading) return <div className="animate-fade-in">Loading Belltower...</div>;

  const upcomingBookings = bookings.filter(b => b.status === 'requested' || b.status === 'confirmed' || b.status === 'quoted');

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div>
          <div className="eyebrow" style={{ color: '#DAA55E' }}>Belltower</div>
          <h2>Venue Bookings</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: isAccepting ? 'var(--success)' : 'var(--text-muted)', fontWeight: 500 }}>
            {isAccepting ? 'Accepting' : 'Paused'}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isAccepting}
              onChange={() => handleToggleAccepting(!isAccepting)}
              style={{ accentColor: 'var(--accent-primary)', transform: 'scale(1.5)' }}
            />
          </label>
        </div>
        {errorMsg && (
          <div style={{ background: 'rgba(255,50,50,0.1)', color: 'var(--danger)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
            <strong>Error Loading Data:</strong> {errorMsg}
          </div>
        )}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left Column: Agenda & Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <section className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.2rem' }}>All caught up 🎉</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>Upcoming</button>
                <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>All</button>
              </div>
            </div>

            {upcomingBookings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                <p>No upcoming bookings yet.</p>
                <p style={{ fontSize: '0.875rem' }}>Share your booking link to start filling the calendar.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {upcomingBookings.map(b => (
                  <div key={b.id} style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{b.name}</strong>
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{b.booking_date}</span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {b.service_name} • {b.party_size} guests
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🔔 Booking alerts
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
              Email me when a new booking comes in:
            </p>
            <form onSubmit={handleSaveEmail} style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
              <input
                type="email"
                className="input-field"
                value={draftEmail}
                onChange={e => setDraftEmail(e.target.value)}
                placeholder="accounting@domain.com"
              />
              <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Save</button>
            </form>
          </section>

        </div>

        {/* Right Column: Block Off Time & Calendar Sync */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          <section className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--danger)' }}>⛔</span> Block off time
            </h3>

            <form onSubmit={handleAddBlock} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Date</label>
                <input type="date" className="input-field" value={blockDate} onChange={e => setBlockDate(e.target.value)} required />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>From</label>
                  <input type="time" className="input-field" value={blockFrom} onChange={e => setBlockFrom(e.target.value)} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>To</label>
                  <input type="time" className="input-field" value={blockTo} onChange={e => setBlockTo(e.target.value)} required />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Reason (optional)</label>
                <input type="text" className="input-field" placeholder="e.g. Out of office" value={blockReason} onChange={e => setBlockReason(e.target.value)} />
              </div>

              <button type="submit" className="btn btn-outline" style={{ marginTop: '8px', alignSelf: 'flex-start' }}>Add block</button>
            </form>

            {blackouts.length > 0 && (
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Upcoming Blackouts</h4>
                {blackouts.map(b => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <div style={{ fontSize: '0.875rem' }}>{b.start_at.split(' ')[0]}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{b.start_at.split(' ')[1]} - {b.end_at.split(' ')[1]}</div>
                    </div>
                    <button onClick={() => handleRemoveBlock(b.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.875rem' }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="glass-panel" style={{ padding: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📅 Sync to your calendar
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
              Subscribe your phone or Google calendar to this private link — new bookings appear automatically.
            </p>

            {calendarToken ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input
                  type="text"
                  className="input-field"
                  readOnly
                  value={`${BELLTOWER_PUBLIC}/api/cal/${business.slug}.ics?token=${calendarToken}`}
                  onClick={(e) => { e.target.select(); navigator.clipboard.writeText(e.target.value); }}
                  style={{ fontSize: '0.75rem', opacity: 0.8 }}
                />
                <button onClick={handleGenerateLink} className="btn btn-outline" style={{ alignSelf: 'flex-start', fontSize: '0.875rem' }}>
                  Regenerate Link
                </button>
              </div>
            ) : (
              <button onClick={handleGenerateLink} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                Generate calendar link
              </button>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
