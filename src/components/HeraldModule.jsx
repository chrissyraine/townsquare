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

  const [hoursOverride, setHoursOverride] = useState({
    active: false,
    status: 'closed', // 'closed', 'open_special'
    note: ''
  });

  const [instagramConnected, setInstagramConnected] = useState(false);
  const [facebookConnected, setFacebookConnected] = useState(false);

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

          if (data.hours && data.hours.status !== 'open') {
            setHoursOverride({
              active: true,
              status: data.hours.status,
              note: data.hours.note || ''
            });
          }

          // Check if we have connected social accounts
          if (data.social_feed && data.social_feed.length > 0) {
            const platforms = data.social_feed.map(p => p.platform);
            if (platforms.includes('instagram')) setInstagramConnected(true);
            if (platforms.includes('facebook')) setFacebookConnected(true);
          }
        }
      } catch (err) {
        console.error("Failed to load Herald state", err);
      } finally {
        setLoading(false);
      }
    };
    fetchState();
  }, [business.slug]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // 1. Save Announcement
      await fetch(`${HERALD_API}/api/businesses/${business.slug}/announcement`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          active: announcement.active,
          text: announcement.text,
          expiresAt: announcement.expiresAt ? new Date(announcement.expiresAt).toISOString() : null
        })
      });

      // 2. Save Hours Override
      await fetch(`${HERALD_API}/api/businesses/${business.slug}/hours/override`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          active: hoursOverride.active,
          status: hoursOverride.status,
          note: hoursOverride.note
        })
      });

      setMessage({ type: 'success', text: 'Changes saved and syndicated successfully.' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save changes. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleConnectMeta = async (platform) => {
    // In reality, this opens a popup to Meta OAuth, gets a code, and exchanges it for a token.
    // We mock that flow here and post the result to our API.
    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      await fetch(`${HERALD_API}/api/businesses/${business.slug}/meta-auth`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          platform: platform,
          access_token: `mock-long-lived-token-${platform}-${Date.now()}`,
          expires_in_days: 60
        })
      });

      if (platform === 'instagram') setInstagramConnected(true);
      if (platform === 'facebook') setFacebookConnected(true);
    } catch (err) {
      alert("Failed to connect to Meta.");
    }
  };

  if (loading) return <div className="animate-fade-in">Loading Herald settings...</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <div className="eyebrow">The Herald</div>
        <h2>Freshness Layer</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          This module automatically pulls your latest social posts and menu specials. 
          Use the controls below to manage your operating hours and broadcast temporary announcements.
        </p>
      </header>

      {/* Social Connection */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Social Sync (Meta)</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
          Connect your business Facebook and Instagram accounts to automatically mirror your latest posts to your website. 
          You only need to authorize this once.
        </p>
        
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {/* Instagram Connect */}
          {instagramConnected ? (
            <div className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'default', borderColor: 'var(--success)', color: 'var(--success)' }}>
              <span>✓ Instagram Syncing</span>
            </div>
          ) : (
            <button className="btn btn-outline" onClick={() => handleConnectMeta('instagram')}>
              Connect Instagram
            </button>
          )}

          {/* Facebook Connect */}
          {facebookConnected ? (
             <div className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'default', borderColor: 'var(--success)', color: 'var(--success)' }}>
              <span>✓ Facebook Syncing</span>
            </div>
          ) : (
            <button className="btn btn-outline" onClick={() => handleConnectMeta('facebook')}>
              Connect Facebook Page
            </button>
          )}
        </div>
      </section>

      <form onSubmit={handleSave}>
        {/* Hours & Overrides */}
        <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Today's Status</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            Override your regular operating hours. Useful for holidays or unexpected closures.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
              <input 
                type="checkbox" 
                checked={hoursOverride.active} 
                onChange={(e) => setHoursOverride({...hoursOverride, active: e.target.checked})}
                style={{ accentColor: 'var(--accent-primary)' }}
              />
              Override Regular Hours Today
            </label>
          </div>

          {hoursOverride.active && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', animation: 'fadeIn 0.3s' }}>
              <div className="input-group" style={{ flex: '1', minWidth: '200px' }}>
                <label className="input-label">Status</label>
                <select 
                  className="input-field"
                  value={hoursOverride.status}
                  onChange={(e) => setHoursOverride({...hoursOverride, status: e.target.value})}
                >
                  <option value="closed">Closed Today</option>
                  <option value="open_special">Special Hours</option>
                </select>
              </div>
              <div className="input-group" style={{ flex: '2', minWidth: '200px' }}>
                <label className="input-label">Public Note (Optional)</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="e.g. Closed for the holidays"
                  value={hoursOverride.note}
                  onChange={(e) => setHoursOverride({...hoursOverride, note: e.target.value})}
                />
              </div>
            </div>
          )}
        </section>

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
