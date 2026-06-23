import { useState } from 'react';
import HeraldModule from './HeraldModule';
import DrawbridgeModule from './DrawbridgeModule';

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
        return (
          <div className="animate-fade-in">
            <h2>The Belfry: Bookings</h2>
            <p style={{ color: 'var(--text-muted)' }}>Manage appointments and event capacity.</p>
            <div className="glass-panel" style={{ padding: '24px', marginTop: '16px' }}>
              <p>Belltower Module Placeholder</p>
            </div>
          </div>
        );
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
            style={{ justifyContent: 'flex-start' }}
            onClick={() => setActiveTab('belltower')}
          >
            📅 Belltower
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
