import { useState, useEffect } from 'react';

// Paige reads the inquiries captured by a tenant's website contact form.
// Data lives in Belltower's inquiry engine; we reach it through the same
// server-side broker the Belltower module uses (no tokens in the browser).
const BELLTOWER_API = '/api/m/belltower';
const STATUSES = ['new', 'contacted', 'won', 'lost'];

export default function CourierModule({ business }) {
  const [loading, setLoading] = useState(true);
  const [inquiries, setInquiries] = useState([]);
  const [err, setErr] = useState(null);

  const load = async () => {
    try {
      setErr(null);
      const res = await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/inquiries`, { credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        setInquiries(d.inquiries || []);
      } else {
        setErr(`Couldn't load messages (${res.status})`);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [business.slug]);

  const setStatus = async (id, status) => {
    setInquiries((xs) => xs.map((x) => (x.id === id ? { ...x, status } : x)));
    await fetch(`${BELLTOWER_API}/api/belfry/${business.slug}/inquiries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };

  if (loading) return <div className="animate-fade-in">Loading Paige…</div>;

  const newCount = inquiries.filter((i) => i.status === 'new').length;

  return (
    <div className="animate-fade-in">
      <div className="eyebrow" style={{ color: '#DAA55E' }}>Paige</div>
      <h2>
        Website messages
        {newCount > 0 && (
          <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700, color: '#0a0807', background: '#DAA55E', borderRadius: 999, padding: '2px 10px', verticalAlign: 'middle' }}>
            {newCount} new
          </span>
        )}
      </h2>
      <p style={{ color: 'var(--text-muted)', maxWidth: 620 }}>
        Every message from your website&rsquo;s contact form is recorded here and emailed to you the
        moment it arrives — and your customer gets an instant &ldquo;we got it&rdquo; reply.
      </p>

      {err && (
        <div className="glass-panel" style={{ padding: 16, marginTop: 16, color: '#c66' }}>{err}</div>
      )}

      {inquiries.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, marginTop: 16, color: 'var(--text-muted)' }}>
          No messages yet. When someone fills out your contact form, it&rsquo;ll appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {inquiries.map((q) => (
            <div key={q.id} className="glass-panel" style={{ padding: 16, opacity: q.status === 'won' || q.status === 'lost' ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <b>{q.name}</b>
                  {q.event_type && <span style={{ color: 'var(--text-muted)' }}> · {q.event_type}</span>}
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {q.email}{q.phone ? ` · ${q.phone}` : ''}
                  </div>
                </div>
                <select
                  value={q.status}
                  onChange={(e) => setStatus(q.id, e.target.value)}
                  style={{ background: 'rgba(0,0,0,.25)', color: 'var(--text)', border: '1px solid rgba(200,169,106,.4)', borderRadius: 8, padding: '4px 8px' }}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {q.message && <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{q.message}</p>}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{q.created_at}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
