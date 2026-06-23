import { useState } from 'react';
import HeraldModule from './HeraldModule';
import DrawbridgeModule from './DrawbridgeModule';
import BelltowerModule from './BelltowerModule';
import HearthModule from './HearthModule';

// Sidebar order + presentation. `external` modules (Forge) deep-link out instead
// of rendering an in-hub panel.
const MODULES = [
  { key: 'herald', label: 'The Herald', icon: <img src="/theherald.svg" alt="" style={{ width: 22, height: 22 }} /> },
  { key: 'drawbridge', label: 'Drawbridge', icon: <img src="/drawbridge.svg" alt="" style={{ width: 22, height: 22 }} /> },
  { key: 'belltower', label: 'Belltower', icon: <span style={{ fontSize: 18 }}>🔔</span> },
  { key: 'hearth', label: 'The Hearth', icon: <span style={{ fontSize: 18 }}>🔥</span> },
  { key: 'forge', label: 'The Forge', icon: <span style={{ fontSize: 18 }}>⚒️</span>, external: true },
];

const FORGE_URL = 'https://gettheforge.app';

export default function Dashboard({ business, onLogout }) {
  const modules = business?.modules || {};
  const firstEnrolled = MODULES.find((m) => modules[m.key] && !m.external)?.key || 'herald';
  const [activeTab, setActiveTab] = useState(firstEnrolled);

  const renderContent = () => {
    const meta = MODULES.find((m) => m.key === activeTab);
    if (!meta) return null;

    if (meta.external) return <ForgeTile enrolled={!!modules.forge} />;
    if (!modules[activeTab]) return <Upsell label={meta.label} moduleKey={activeTab} />;

    switch (activeTab) {
      case 'herald': return <HeraldModule business={business} />;
      case 'drawbridge': return <DrawbridgeModule business={business} />;
      case 'belltower': return <BelltowerModule business={business} />;
      case 'hearth': return <HearthModule business={business} />;
      default: return null;
    }
  };

  return (
    <div className="app-container">
      <aside className="glass-panel" style={{ width: '280px', borderRadius: 0, borderLeft: 'none', borderTop: 'none', borderBottom: 'none', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '40px' }}>
          <h1 className="text-gradient" style={{ fontSize: '1.5rem' }}>TownSquare</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{business?.name}</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
          {MODULES.map((m) => {
            const enrolled = !!modules[m.key];
            const active = activeTab === m.key;
            return (
              <button
                key={m.key}
                className={`btn ${active ? 'btn-primary' : 'btn-outline'}`}
                style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '10px', opacity: enrolled || m.external ? 1 : 0.55 }}
                onClick={() => setActiveTab(m.key)}
              >
                <span style={{ filter: active ? 'none' : 'grayscale(0.6)' }}>{m.icon}</span>
                <span style={{ flexGrow: 1, textAlign: 'left' }}>{m.label}</span>
                {!enrolled && !m.external && (
                  <span style={{ fontSize: '0.65rem', letterSpacing: '0.05em', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: 4, padding: '1px 5px' }}>ADD</span>
                )}
                {m.external && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>↗</span>}
              </button>
            );
          })}
        </nav>

        <div>
          <button className="btn btn-outline" style={{ width: '100%', borderColor: 'var(--border-light)', color: 'var(--text-muted)' }} onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>

      <main style={{ flexGrow: 1, padding: '40px', overflowY: 'auto' }}>
        {renderContent()}
      </main>
    </div>
  );
}

// Shown when an owner opens a module they're not enrolled in — the upsell surface.
function Upsell({ label, moduleKey }) {
  const pitch = {
    herald: 'Broadcast announcements and live hours straight onto your website — no logins to your site builder.',
    drawbridge: 'Run your live menu from your phone: mark items sold out and post daily specials in seconds.',
    belltower: 'Take bookings 24/7 — appointments, tables, or whole events — synced to your calendar.',
    hearth: 'Grow your Google reviews and catch unhappy customers privately, before they post.',
  }[moduleKey] || 'Add this module to your TownSquare.';

  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px' }}>
      <div className="eyebrow">Not yet active</div>
      <h2>{label}</h2>
      <div className="glass-panel" style={{ padding: '32px', marginTop: '16px' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>{pitch}</p>
        <button className="btn btn-primary" onClick={() => alert(`We'll set up ${label} for ${' '}your business. (Onboarding flow comes in a later phase.)`)}>
          Add {label} to my TownSquare
        </button>
      </div>
    </div>
  );
}

// The Forge isn't brokered (Vercel + separate 3D engine) — launch-tile only.
function ForgeTile({ enrolled }) {
  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px' }}>
      <div className="eyebrow">The Forge</div>
      <h2>Design-it-yourself</h2>
      <div className="glass-panel" style={{ padding: '32px', marginTop: '16px' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          Let customers build their own custom order — a cake, a bouquet, furniture — in an
          interactive 3D designer on your branded site, then send you the exact spec.
        </p>
        <a className="btn btn-primary" href={FORGE_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          {enrolled ? 'Open The Forge ↗' : 'Explore The Forge ↗'}
        </a>
      </div>
    </div>
  );
}
