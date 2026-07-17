import { useState } from 'react';
import HeraldModule from './HeraldModule';
import DrawbridgeModule from './DrawbridgeModule';
import BelltowerModule from './BelltowerModule';
import HearthModule from './HearthModule';
import CourierModule from './CourierModule';
import DashboardHome from './DashboardHome';
import BusinessProfileEditor from './BusinessProfileEditor';
import HoursManager from './HoursManager';
import EventsManager from './EventsManager';
import TeamManager from './TeamManager';
import PublicPreview from './PublicPreview';
import { MODULES } from './moduleRegistry';

// Hub-native tabs — TownSquare's own data (profile/hours/events/team/preview),
// as opposed to MODULES which are brokered into sibling products. Team is
// hidden for STAFF sessions (team management is OWNER/MANAGER-only per the
// role spec); the server enforces this independently either way.
const HOME_TABS = [
  { key: 'home', label: 'Home', emoji: '🏠' },
  { key: 'profile', label: 'My Business', emoji: '🏛️' },
  { key: 'hours', label: 'Hours', emoji: '🕰️' },
  { key: 'events', label: 'Events', emoji: '📅' },
  { key: 'team', label: 'Team', emoji: '👥', minRole: 'MANAGER' },
  { key: 'preview', label: 'Public Preview', emoji: '👁️' },
];

const FORGE_URL = 'https://gettheforge.app';
// The Paige (calls & SMS). getthepaige.app must be pointed at the existing
// Paige worker (Cloudflare → the worker → Custom Domains) for this link to resolve.
const PAIGE_URL = 'https://getthepaige.app';
const ROLE_RANK = { STAFF: 0, MANAGER: 1, OWNER: 2 };

export default function Dashboard({ business, onLogout }) {
  const modules = business?.modules || {};
  const role = business?.role || 'STAFF';
  const [activeTab, setActiveTab] = useState('home');

  const visibleHomeTabs = HOME_TABS.filter((t) => !t.minRole || ROLE_RANK[role] >= ROLE_RANK[t.minRole]);

  const renderContent = () => {
    switch (activeTab) {
      case 'home': return <DashboardHome business={business} onNavigate={setActiveTab} />;
      case 'profile': return <BusinessProfileEditor business={business} />;
      case 'hours': return <HoursManager business={business} />;
      case 'events': return <EventsManager business={business} />;
      case 'team':
        if (ROLE_RANK[role] < ROLE_RANK.MANAGER) return <DashboardHome business={business} onNavigate={setActiveTab} />;
        return <TeamManager business={business} />;
      case 'preview': return <PublicPreview />;
      default: break;
    }

    const meta = MODULES.find((m) => m.key === activeTab);
    if (!meta) return <DashboardHome business={business} onNavigate={setActiveTab} />;

    if (meta.external) {
      if (activeTab === 'paige') return <PaigeTile enrolled={!!modules.paige} />;
      return <ForgeTile enrolled={!!modules.forge} />;
    }
    if (!modules[activeTab]) return <Upsell label={meta.label} moduleKey={activeTab} />;

    switch (activeTab) {
      case 'herald': return <HeraldModule business={business} />;
      case 'drawbridge': return <DrawbridgeModule business={business} />;
      case 'belltower': return <BelltowerModule business={business} />;
      case 'hearth': return <HearthModule business={business} />;
      case 'courier': return <CourierModule business={business} />;
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

        <div className="ts-biz">Signed in as <b>{business?.userName || business?.name}</b></div>

        <nav className="ts-nav">
          {visibleHomeTabs.map((t) => (
            <button
              key={t.key}
              className={`ts-navitem${activeTab === t.key ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <span className="ts-navitem__ico"><span style={{ fontSize: 18 }}>{t.emoji}</span></span>
              <span className="ts-navitem__label">{t.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ borderTop: '1px solid var(--border-light)', margin: '12px 0' }} />

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
                <span className="ts-navitem__ico">
                  {m.icon ? <img src={m.icon} alt="" style={{ width: 22, height: 22 }} /> : <span style={{ fontSize: 18 }}>{m.emoji}</span>}
                </span>
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
  const meta = MODULES.find((m) => m.key === moduleKey);
  const pitch = meta?.pitch || 'Add this module to your TownSquare.';

  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px' }}>
      <div className="eyebrow">Not yet active</div>
      <h2>{label}</h2>
      <div className="glass-panel" style={{ padding: '32px', marginTop: '16px' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>{pitch}</p>
        <button className="btn btn-primary" onClick={() => alert(`We'll set up ${label} for ${' '}your business. (Onboarding flow comes in a later phase.)`)}>
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

// The Paige (calls & SMS) isn't brokered (separate Worker + carrier) — launch-tile only.
function PaigeTile({ enrolled }) {
  return (
    <div className="animate-fade-in" style={{ maxWidth: '640px' }}>
      <div className="eyebrow">The Paige</div>
      <h2>Calls &amp; SMS</h2>
      <div className="glass-panel" style={{ padding: '32px', marginTop: '16px' }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          Give your business its own number with missed-call text-back and a Claude-powered
          agent that answers, qualifies leads, and books them — so a missed call becomes a job.
        </p>
        <a className="btn btn-primary" href={PAIGE_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          {enrolled ? 'Open The Paige ↗' : 'Explore The Paige ↗'}
        </a>
      </div>
    </div>
  );
}
