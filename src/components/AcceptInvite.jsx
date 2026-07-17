import { useState, useEffect } from 'react';

// Mounted by App.jsx when the URL carries ?invite=<code>. Lets a newly invited
// teammate pick their own PIN — this IS their login, no email/password to set
// up. On success it hands the returned session straight to App, same shape as
// Landing.jsx's onLogin.
export default function AcceptInvite({ code, onAccepted, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/team/invite/${code}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setInvite(d))
      .catch(() => setError('This invitation link is invalid or has expired. Ask the business owner to send a new one.'))
      .finally(() => setLoading(false));
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,8}$/.test(pin)) { setError('Choose a 4-8 digit PIN.'); return; }
    if (pin !== confirmPin) { setError('PINs do not match.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/team/invite/${code}/accept`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onAccepted({ slug: data.slug, name: data.name, town: data.town, modules: data.modules || {}, role: data.role, userId: data.userId, userName: name });
      } else {
        setError(data.error || 'Could not accept this invitation.');
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
          {invite && <div className="login-subtitle">Join {invite.business_name} as {invite.role.toLowerCase()}</div>}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Loading invitation…</p>
        ) : error && !invite ? (
          <>
            <p style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '20px' }}>{error}</p>
            <button type="button" className="btn btn-outline" style={{ width: '100%' }} onClick={onCancel}>Back to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="input-group">
              <label className="input-label">Your name</label>
              <input className="input-field" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Choose a PIN (4-8 digits)</label>
              <input className="input-field" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Confirm PIN</label>
              <input className="input-field" type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} required />
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '16px' }}>{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>{submitting ? 'Joining…' : 'Join the team'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
