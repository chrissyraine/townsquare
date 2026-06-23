import { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SparkleTrail from './components/SparkleTrail';

export default function App() {
  const [session, setSession] = useState(null);

  // Auto-login if we have a token stored
  useEffect(() => {
    const savedToken = localStorage.getItem('townsquare_token');
    const savedTokensRaw = localStorage.getItem('townsquare_tokens');
    const savedSlug = localStorage.getItem('townsquare_slug');
    const savedName = localStorage.getItem('townsquare_name');

    if (savedToken && savedSlug) {
      setSession({
        slug: savedSlug,
        token: savedToken,
        tokens: savedTokensRaw ? JSON.parse(savedTokensRaw) : { herald: savedToken },
        name: savedName || savedSlug.toUpperCase()
      });
    }
  }, []);

  const handleLogin = (authData) => {
    localStorage.setItem('townsquare_token', authData.token);
    if (authData.tokens) localStorage.setItem('townsquare_tokens', JSON.stringify(authData.tokens));
    localStorage.setItem('townsquare_slug', authData.slug);
    localStorage.setItem('townsquare_name', authData.name);
    setSession(authData);
  };

  const handleLogout = () => {
    localStorage.removeItem('townsquare_token');
    localStorage.removeItem('townsquare_tokens');
    localStorage.removeItem('townsquare_slug');
    localStorage.removeItem('townsquare_name');
    setSession(null);
  };

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
      <Dashboard 
        business={{ slug: session.slug, name: session.name, token: session.token, tokens: session.tokens }} 
        onLogout={handleLogout} 
      />
    </>
  );
}
