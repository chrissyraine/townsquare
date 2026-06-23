import { useState } from 'react';

export default function Login({ onLogin }) {
  const [slug, setSlug] = useState('titusville-mill');
  const [pin, setPin] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const HERALD_API = 'https://theherald.pages.dev';
      const DRAWBRIDGE_API = 'https://getdrawbridge.app';
      
      const [heraldRes, drawbridgeRes] = await Promise.all([
        fetch(`${HERALD_API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, pin })
        }),
        // Drawbridge uses /keep/login for restaurant owners
        fetch(`${DRAWBRIDGE_API}/api/auth/keep/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, pin })
        }).catch(() => ({ ok: false })) // Catch network errors safely
      ]);

      const heraldData = await heraldRes.json();
      let drawbridgeData = {};
      if (drawbridgeRes && drawbridgeRes.ok) {
        drawbridgeData = await drawbridgeRes.json();
      }

      if (!heraldRes.ok) {
        setError(heraldData.error || "Invalid PIN. Please try again.");
      } else {
        onLogin({ 
          slug: heraldData.slug, 
          token: heraldData.token, // Main herald token (legacy)
          tokens: {
            herald: heraldData.token,
            drawbridge: drawbridgeData.token || null
          },
          businessId: heraldData.businessId,
          name: slug.replace('-', ' ').toUpperCase() 
        });
      }
    } catch (err) {
      setError("Network error connecting to authentication services.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="glass-panel login-card animate-fade-in">
        <div className="login-header">
          <h1 className="login-logo text-gradient">TownSquare</h1>
          <p className="login-subtitle">Unified Owner Dashboard</p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label" htmlFor="slug">Business Slug</label>
            <input 
              id="slug"
              type="text" 
              className="input-field" 
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. titusville-mill"
              required
            />
          </div>
          
          <div className="input-group">
            <label className="input-label" htmlFor="pin">Access PIN</label>
            <input 
              id="pin"
              type="password" 
              className="input-field" 
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
              required
            />
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', marginBottom: '16px', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ width: '100%', marginTop: '8px' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Enter the Hub'}
          </button>
        </form>
      </div>
    </div>
  );
}
