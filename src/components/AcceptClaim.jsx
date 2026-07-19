import { useState, useEffect } from 'react';

// Mounted by App.jsx when the URL carries ?claim=<code>. This code only exists
// AFTER an admin has approved a listing claim (see EventsManager-style flow on
// titusvillesquare.com's claim-listing.html, reviewed via /api/square/claims) —
// holding it is sufficient to set a PIN and log in, but getting here in the
// first place required a human to approve the claim first. Structurally
// mirrors AcceptInvite.jsx.
export default function AcceptClaim({ code, onAccepted, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [claim, setClaim] = useState(null);
  const [error, setError] = useState(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/claim/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setClaim(d))
      .catch(() => setError('This claim link is invalid or has expired. Contact Chrissy to request a new one.'))
      .finally(() => setLoading(false));
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) { setError('Choose a 4-8 digit PIN.'); return; }
    if (pin !== confirmPin) { setError('PINs do not match.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/claim/${code}/accept`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onAccepted({ slug: data.slug, name: data.name, town: data.town, modules: data.modules || {}, role: data.role, userId: data.userId });
      } else {
        setError(data.error || 'Could not complete your claim.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card glass-panel">
        <div className="login-header">
          <div className="login-logo">TownSquare</div>
          {claim && <div className="login-subtitle">Claim {claim.business_name}</div>}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading your claim…</p>
        ) : error && !claim ? (
          <>
            <p style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '20px' }}>{error}</p>
            <button type="button" className="btn btn-outline" style={{ width: '100%' }} onClick={onCancel}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '20px' }}>
              Your claim on <strong>{claim.business_name}</strong> was approved. Choose a PIN to finish setting up your dashboard.
            </p>
            <div className="input-group">
              <label className="input-label">Choose a PIN (4-8 digits)</label>
              <input className="input-field" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Confirm PIN</label>
              <input className="input-field" type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} required />
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '16px' }}>{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>{submitting ? 'Setting up…' : 'Finish claiming my listing'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
