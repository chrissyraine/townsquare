import { useState, useEffect } from 'react';

// All calls go through the TownSquare proxy, which mints a Hall-scoped token
// server-side. No tokens in the browser.
const HEARTH_API = '/api/m/hearth';

export default function HearthModule({ business }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [reviewUrl, setReviewUrl] = useState(null);

  const fetchState = async () => {
    try {
      setErrorMsg(null);
      const res = await fetch(`${HEARTH_API}/api/hall/${business.slug}/state`, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics || null);
        setFeedback(data.feedback || []);
        setReviewUrl(data.business?.google_review_url || null);
      } else {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(d.error === 'not_enrolled' ? 'This business is not set up in The Hearth yet.' : `Couldn't reach The Hearth (${res.status}).`);
      }
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchState(); }, [business.slug]);

  const updateStatus = async (id, status) => {
    setFeedback((fb) => fb.map((f) => (f.id === id ? { ...f, status } : f)));
    await fetch(`${HEARTH_API}/api/hall/${business.slug}/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ status }),
    });
  };

  if (loading) return <div className="animate-fade-in">Loading The Hearth…</div>;

  const privateFeedback = feedback.filter((f) => f.took_private && f.comment);

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <div className="eyebrow" style={{ color: '#C8714A' }}>The Hearth</div>
        <h2>Reviews &amp; Retention</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Watch your review growth and catch unhappy customers privately — before they post publicly.
        </p>
      </header>

      {errorMsg && (
        <div className="glass-panel" style={{ padding: '16px', marginBottom: '24px', color: 'var(--danger)' }}>
          {errorMsg}
        </div>
      )}

      {metrics && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
          <Stat label="Total feedback" value={metrics.feedback_count ?? 0} />
          <Stat label="Avg rating" value={metrics.avg_rating != null ? Number(metrics.avg_rating).toFixed(2) : '—'} />
          <Stat label="Sent to Google" value={metrics.clicked_google ?? metrics.google_clicks ?? 0} />
        </section>
      )}

      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Private feedback to resolve</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
          Customers who chose to tell you privately instead of leaving a public review. Reach out and make it right.
        </p>
        {privateFeedback.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
            No private feedback waiting. 🎉
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {privateFeedback.map((f) => (
              <div key={f.id} style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{'★'.repeat(f.rating)}<span style={{ opacity: 0.3 }}>{'★'.repeat(Math.max(0, 5 - f.rating))}</span></strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{(f.created_at || '').split('T')[0]}</span>
                </div>
                <p style={{ margin: '8px 0', fontSize: '0.9rem' }}>{f.comment}</p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', fontSize: '0.8rem' }}>
                  {f.contact_email && <a href={`mailto:${f.contact_email}`} style={{ color: 'var(--accent-primary)' }}>{f.contact_email}</a>}
                  <span style={{ flexGrow: 1 }} />
                  {f.status !== 'resolved' ? (
                    <button className="btn btn-outline" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={() => updateStatus(f.id, 'resolved')}>Mark resolved</button>
                  ) : (
                    <span style={{ color: 'var(--success)' }}>✓ Resolved</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {reviewUrl && (
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Your Google review link</h3>
          <input type="text" className="input-field" readOnly value={reviewUrl}
            onClick={(e) => { e.target.select(); navigator.clipboard.writeText(e.target.value); }}
            style={{ fontSize: '0.8rem' }} />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="glass-panel" style={{ padding: '20px', textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', fontWeight: 600 }} className="text-gradient">{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}
