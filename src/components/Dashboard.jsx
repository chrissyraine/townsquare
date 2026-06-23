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
      <aside className="ts-side">
        <div className="ts-brand">
          <svg className="ts-brand__mark" viewBox="0 0 100 100" aria-hidden="true">
            <rect width="100" height="100" rx="22" fill="#1c1a18" stroke="rgba(200,169,106,.4)" />
            <path transform="translate(14,14) scale(0.72)" fill="var(--accent-primary)" d="M50 14 L84 40 H16 Z M20 40h60v6H20z M26 48h6v26h-6z M44 48h6v26h-6z M62 48h6v26h-6z M74 48h6v26h-6z M16 76h68v7H16z" />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span className="ts-brand__name">TownSquare</span>
            <span className="ts-brand__sub">by Forever Still Studio</span>
          </span>
        </div>

        <div className="ts-biz">Signed in as <b>{business?.name}</b></div>

        <nav className="ts-nav">
          {MODULES.map((m) => {
            const enrolled = !!modules[m.key];
            const active = activeTab === m.key;
            const dim = !enrolled && !m.external;
            return (
              <button
                key={m.key}
                className={`ts-navitem${active ? ' active' : ''}${dim ? ' dim' : ''}`}
                onClick={() => setActiveTab(m.key)}
              >
                <span className="ts-navitem__ico">{m.icon}</span>
                <span className="ts-navitem__label">{m.label}</span>
                {dim && <span className="ts-navitem__add">ADD</span>}
                {m.external && <span className="ts-navitem__ext">↗</span>}
              </button>
            );
          })}
        </nav>

        <button className="ts-logout" onClick={onLogout}>Sign out</button>
      </aside>

      <main className="ts-main">
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
