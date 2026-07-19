import { useState, useEffect } from 'react';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import SparkleTrail from './components/SparkleTrail';
import AcceptInvite from './components/AcceptInvite';
import AcceptClaim from './components/AcceptClaim';

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(window.location.search).get('invite'));
  const [claimCode, setClaimCode] = useState(() => new URLSearchParams(window.location.search).get('claim'));

  // Restore session from the httpOnly cookie via the worker (no tokens in JS).
  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.slug) setSession(d); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogin = (data) => setSession(data);

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
    setSession(null);
  };

  const clearInvite = () => {
    setInviteCode(null);
    window.history.replaceState({}, '', window.location.pathname);
  };

  const clearClaim = () => {
    setClaimCode(null);
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (checking) {
    return (
      <>
        <SparkleTrail />
        <div className="login-wrapper">
          <div className="login-subtitle" style={{ opacity: 0.6 }}>Loading TownSquare…</div>
        </div>
      </>
    );
  }

  // An invite link is an explicit action to join as a (possibly different)
  // identity — it takes priority even if this browser already has a valid
  // session cookie for another business (e.g. the owner testing their own
  // invite link, or someone already signed in elsewhere).
  if (inviteCode) {
    return (
      <>
        <SparkleTrail />
        <AcceptInvite code={inviteCode} onAccepted={(data) => { setSession(data); clearInvite(); }} onCancel={clearInvite} />
      </>
    );
  }

  // Same priority reasoning as the invite branch above — a claim link is an
  // explicit action that should never silently fall through to an unrelated
  // existing session. No legitimate flow produces both ?invite= and ?claim=
  // at once; invite is checked first, arbitrarily but deterministically.
  if (claimCode) {
    return (
      <>
        <SparkleTrail />
        <AcceptClaim code={claimCode} onAccepted={(data) => { setSession(data); clearClaim(); }} onCancel={clearClaim} />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <SparkleTrail />
        <Landing onLogin={handleLogin} />
      </>
    );
  }

  return (
    <>
      <SparkleTrail />
      <Dashboard business={session} onLogout={handleLogout} />
    </>
  );
}
