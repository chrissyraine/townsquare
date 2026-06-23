import { useState } from 'react';
import HeraldModule from './HeraldModule';
import DrawbridgeModule from './DrawbridgeModule';
import BelltowerModule from './BelltowerModule';

export default function Dashboard({ business, onLogout }) {
  const [activeTab, setActiveTab] = useState('herald');

  // We'll stub out the inner modules for now. These will eventually be full components.
  const renderContent = () => {
    switch (activeTab) {
      case 'herald':
        return <HeraldModule business={business} />;
      case 'drawbridge':
        return <DrawbridgeModule business={business} />;
      case 'belltower':
        return <BelltowerModule business={business} />;
      case 'hearth':
        return (
          <div className="animate-fade-in">
            <h2>The Hall: Reviews & Retention</h2>
            <p style={{ color: 'var(--text-muted)' }}>Monitor customer feedback and retention metrics.</p>
            <div className="glass-panel" style={{ padding: '24px', marginTop: '16px' }}>
              <p>Hearth Module Placeholder</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="glass-panel" style={{ width: '280px', borderRadius: '0', borderLeft: 'none', borderTop: 'none', borderBottom: 'none', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '40px' }}>
          <h1 className="text-gradient" style={{ fontSize: '1.5rem' }}>TownSquare</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{business?.name}</p>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1 }}>
          <button 
            className={`btn ${activeTab === 'herald' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => setActiveTab('herald')}
          >
            <img src="/theherald.svg" alt="" style={{ width: '24px', height: '24px', filter: activeTab === 'herald' ? 'none' : 'grayscale(1) opacity(0.7)' }} />
            The Herald
          </button>
          <button 
            className={`btn ${activeTab === 'drawbridge' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => setActiveTab('drawbridge')}
          >
            <img src="/drawbridge.svg" alt="" style={{ width: '24px', height: '24px', filter: activeTab === 'drawbridge' ? 'none' : 'grayscale(1) opacity(0.7)' }} />
            Drawbridge
          </button>
          <button 
            className={`btn ${activeTab === 'belltower' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
            onClick={() => setActiveTab('belltower')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: activeTab === 'belltower' ? 'none' : 'grayscale(1) opacity(0.7)' }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
              <path d="M8 14h.01"></path>
              <path d="M12 14h.01"></path>
              <path d="M16 14h.01"></path>
              <path d="M8 18h.01"></path>
              <path d="M12 18h.01"></path>
              <path d="M16 18h.01"></path>
            </svg>
            Belltower
          </button>
          <button 
            className={`btn ${activeTab === 'hearth' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ justifyContent: 'flex-start' }}
            onClick={() => setActiveTab('hearth')}
          >
            ⭐ The Hearth
          </button>
        </nav>

        <div>
          <button className="btn btn-outline" style={{ width: '100%', borderColor: 'var(--border-light)', color: 'var(--text-muted)' }} onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flexGrow: 1, padding: '40px', overflowY: 'auto' }}>
        {renderContent()}
      </main>
    </div>
  );
}
