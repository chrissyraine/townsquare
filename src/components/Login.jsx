import { useState } from 'react';

export default function Login({ onLogin }) {
  const [slug, setSlug] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Single TownSquare login. The hub authenticates against its own registry
      // and brokers the products server-side — no per-product fan-out, no tokens
      // in the browser (an httpOnly session cookie is set by the worker).
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slug: slug.trim(), pin }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error === 'invalid_login' ? 'Invalid slug or PIN. Please try again.' : (data.error || 'Login failed.'));
      } else {
        onLogin({ slug: data.slug, name: data.name, town: data.town, modules: data.modules || {} });
      }
    } catch {
      setError('Network error connecting to TownSquare.');
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
              placeholder="your-business-slug"
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
