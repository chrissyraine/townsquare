import { useState, useEffect } from 'react';

// Routed through the TownSquare proxy; the worker mints a Business-scoped token
// server-side. No tokens in the browser.
const HERALD_API = '/api/m/herald';

export default function HeraldModule({ business }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const [announcement, setAnnouncement] = useState({
    active: false,
    text: '',
    expiresAt: ''
  });

  const [crierText, setCrierText] = useState('');
  const [crierPosts, setCrierPosts] = useState([]);
  const [crierBusy, setCrierBusy] = useState(false);

  useEffect(() => {
    // Fetch current state on load
    const fetchState = async () => {
      try {
        const res = await fetch(`${HERALD_API}/api/public/businesses/${business.slug}/feed`);
        if (res.ok) {
          const data = await res.json();
          
          if (data.announcement) {
            setAnnouncement({
              active: true,
              text: data.announcement.text || '',
              expiresAt: data.announcement.expires_at ? data.announcement.expires_at.split('T')[0] : ''
            });
          }

          // Hours (weekly + today's override + special dates) moved to HoursManager.jsx
          // so hours management lives in one place. Herald still owns the data.

          // Social sync is not built — the feed always returns []. Nothing to read here.
          // See C:\foreverstill\integrations-roadmap.md.
        }
      } catch (err) {
        console.error("Failed to load Herald state", err);
      } finally {
        setLoading(false);
      }
    };
    fetchState();
  }, [business.slug]);

  useEffect(() => {
    fetch(`${HERALD_API}/api/businesses/${business.slug}/crier`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.posts)) setCrierPosts(d.posts); })
      .catch(() => {});
  }, [business.slug]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // Save Announcement (hours moved to the Hours tab — see HoursManager.jsx)
      await fetch(`${HERALD_API}/api/businesses/${business.slug}/announcement`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          active: announcement.active,
          text: announcement.text,
          expiresAt: announcement.expiresAt ? new Date(announcement.expiresAt).toISOString() : null
        })
      });

      setMessage({ type: 'success', text: 'Changes saved and syndicated successfully.' });
      setTimeout(() => setMessage(null), 3000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save changes. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const postToCrier = async () => {
    const text = crierText.trim();
    if (!text) return;
    setCrierBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${HERALD_API}/api/businesses/${business.slug}/crier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        setCrierText('');
        const r = await fetch(`${HERALD_API}/api/businesses/${business.slug}/crier`);
        if (r.ok) { const d = await r.json(); if (d && Array.isArray(d.posts)) setCrierPosts(d.posts); }
        setMessage({ type: 'success', text: 'Posted to the Town Crier.' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: 'Could not post. Please try again.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Could not post. Please try again.' });
    } finally {
      setCrierBusy(false);
    }
  };

  const deleteCrierPost = async (id) => {
    try {
      await fetch(`${HERALD_API}/api/businesses/${business.slug}/crier/${id}`, { method: 'DELETE' });
      setCrierPosts(crierPosts.filter((p) => p.id !== id));
    } catch { /* ignore */ }
  };

  // handleConnectMeta was removed 2026-07-16. It POSTed a FAKE token
  // (`mock-long-lived-token-…`) to /meta-auth, which stored it as though the business had
  // really connected Instagram/Facebook — and the Herald feed then served an invented post
  // on the client's own website. The buttons below are already disabled; this dead handler
  // was the loaded gun sitting next to them.
  //
  // To build this for real: Meta Developer App + App Review, a genuine OAuth popup, exchange
  // the code for a long-lived token, then POST that to /meta-auth (the endpoint is fine — it
  // stores whatever it's given). See C:\foreverstill\integrations-roadmap.md.
  // Do not re-add a mock.

  if (loading) return <div className="animate-fade-in">Loading Herald settings...</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <div className="eyebrow">The Herald</div>
        <h2>Freshness Layer</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Post quick updates to the Town Crier and broadcast temporary announcements &mdash;
          the freshness layer that keeps your listing on Titusville Square alive. (Manage your
          hours in the Hours tab.)
        </p>
      </header>

      {/* Post to the Town Crier */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Post to the Town Crier</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
          Share a quick update &mdash; a special, an event, good news. It streams straight to the Town Crier on Titusville Square.
        </p>
        <textarea
          className="input-field"
          rows={3}
          placeholder="e.g. Fresh cinnamon rolls out of the oven right now!"
          value={crierText}
          onChange={(e) => setCrierText(e.target.value)}
          style={{ width: '100%', resize: 'vertical', marginBottom: '12px' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={postToCrier} disabled={crierBusy || !crierText.trim()}>
            {crierBusy ? 'Posting...' : 'Post to Town Crier'}
          </button>
        </div>
        {crierPosts.length > 0 && (
          <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Recent posts</div>
            {crierPosts.map((p) => (
              <div key={p.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-soft)' }}>{p.body}</div>
                <button type="button" onClick={() => deleteCrierPost(p.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Social Connection */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
          Social Sync (Meta) <span style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: '999px', padding: '2px 8px', marginLeft: '8px', verticalAlign: 'middle' }}>Coming soon</span>
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
          Soon you'll be able to connect your Facebook and Instagram accounts to automatically mirror your latest
          posts here. It's not live yet &mdash; for now, use the Town Crier box above to share updates.
        </p>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div className="btn btn-outline" style={{ opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' }} aria-disabled="true">
            Connect Instagram &middot; Coming soon
          </div>
          <div className="btn btn-outline" style={{ opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' }} aria-disabled="true">
            Connect Facebook Page &middot; Coming soon
          </div>
        </div>
      </section>

      <form onSubmit={handleSave}>
        {/* Hours management (weekly schedule, today's override, special dates)
            lives in the Hours tab now — see HoursManager.jsx. */}

        {/* Announcement Strip */}
        <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Announcement Strip</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            Broadcast a single-line message across the top of your site. It will automatically disappear after the expiration date.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input 
                type="checkbox" 
                checked={announcement.active} 
                onChange={(e) => setAnnouncement({...announcement, active: e.target.checked})}
                style={{ accentColor: 'var(--accent-primary)' }}
              />
              Enable Announcement
            </label>
          </div>

          {announcement.active && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', animation: 'fadeIn 0.3s' }}>
              <div className="input-group" style={{ flex: '3', minWidth: '200px' }}>
                <label className="input-label">Message</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Join us for live music this Friday at 7PM!"
                  value={announcement.text}
                  onChange={(e) => setAnnouncement({...announcement, text: e.target.value})}
                  required
                />
              </div>
              <div className="input-group" style={{ flex: '1', minWidth: '150px' }}>
                <label className="input-label">Expires On</label>
                <input 
                  type="date" 
                  className="input-field" 
                  value={announcement.expiresAt}
                  onChange={(e) => setAnnouncement({...announcement, expiresAt: e.target.value})}
                  required
                />
              </div>
            </div>
          )}
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', marginTop: '32px' }}>
          {message && (
            <span style={{ color: message.type === 'error' ? 'var(--danger)' : 'var(--success)', fontSize: '0.875rem' }}>
              {message.text}
            </span>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Herald Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
