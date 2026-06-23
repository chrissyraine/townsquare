import { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SparkleTrail from './components/SparkleTrail';

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

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

  if (!session) {
    return (
      <>
        <SparkleTrail />
        <Login onLogin={handleLogin} />
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
