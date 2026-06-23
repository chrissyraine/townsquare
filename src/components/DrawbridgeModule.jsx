import { useState, useEffect } from 'react';

// Routed through the TownSquare proxy; the worker mints a Keep-scoped token
// server-side. No tokens in the browser.
const DRAWBRIDGE_API = '/api/m/drawbridge';

export default function DrawbridgeModule({ business }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [specials, setSpecials] = useState([]);
  const [isOpen, setIsOpen] = useState(true);
  const [closedMessage, setClosedMessage] = useState('');

  const [newSpecialName, setNewSpecialName] = useState('');
  const [newSpecialPrice, setNewSpecialPrice] = useState('');

  const fetchState = async () => {
    try {
      const res = await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/state`, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setSpecials(data.specials || []);
        setIsOpen(data.is_open);
        setClosedMessage(data.closed_message || '');
      }
    } catch (err) {
      console.error("Failed to load Drawbridge state", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [business.slug]);

  const handleToggleItem = async (item) => {
    const newStatus = !item.is_available;
    // Optimistic update
    setItems(items.map(i => i.id === item.id ? { ...i, is_available: newStatus ? 1 : 0 } : i));

    await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ is_available: newStatus })
    });
  };

  const handleUpdatePrice = async (item, newPrice) => {
    const numericPrice = parseFloat(newPrice);
    if (isNaN(numericPrice)) return;

    setItems(items.map(i => i.id === item.id ? { ...i, price: numericPrice } : i));

    await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        name: item.name,
        description: item.description || '',
        price: numericPrice
      })
    });
  };

  const handleAddSpecial = async (e) => {
    e.preventDefault();
    if (!newSpecialName || !newSpecialPrice) return;

    try {
      const res = await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/specials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newSpecialName, price: parseFloat(newSpecialPrice) })
      });
      if (res.ok) {
        setNewSpecialName('');
        setNewSpecialPrice('');
        fetchState(); // Reload to get ID
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveSpecial = async (id) => {
    // Optimistic
    setSpecials(specials.filter(s => s.id !== id));
    await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/specials/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  };

  const handleToggleOrdering = async (active) => {
    setIsOpen(active);
    await fetch(`${DRAWBRIDGE_API}/api/keep/${business.slug}/restaurant`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ is_open: active, closed_message: closedMessage })
    });
  };

  if (loading) return <div className="animate-fade-in">Loading Drawbridge...</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '800px' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <div className="eyebrow" style={{ color: '#B8843A' }}>Drawbridge</div>
        <h2>Online Ordering Control</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Manage your live menu, 86 items instantly, and pause incoming orders if the kitchen is overwhelmed.
        </p>
      </header>

      {/* Master Switch */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Kitchen Status</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Pause all incoming online orders immediately.
            </p>
          </div>
          <button
            className={`btn ${isOpen ? 'btn-outline' : 'btn-primary'}`}
            style={{ borderColor: isOpen ? 'var(--success)' : 'var(--danger)', color: isOpen ? 'var(--success)' : '#fff', backgroundColor: isOpen ? 'transparent' : 'var(--danger)' }}
            onClick={() => handleToggleOrdering(!isOpen)}
          >
            {isOpen ? '✓ Accepting Orders' : 'PAUSED (Click to Resume)'}
          </button>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Specials */}
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Today's Specials</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            Add daily specials to your menu. These automatically sync to your Herald banner.
          </p>

          <div style={{ marginBottom: '16px' }}>
            {specials.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span>{s.name} <span style={{ opacity: 0.6 }}>${Number(s.price).toFixed(2)}</span></span>
                <button onClick={() => handleRemoveSpecial(s.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
            {specials.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No active specials.</span>}
          </div>

          <form onSubmit={handleAddSpecial} style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <input type="text" className="input-field" placeholder="Special Name" value={newSpecialName} onChange={e => setNewSpecialName(e.target.value)} style={{ flex: 2 }} required />
            <input type="number" step="0.01" className="input-field" placeholder="Price" value={newSpecialPrice} onChange={e => setNewSpecialPrice(e.target.value)} style={{ flex: 1 }} required />
            <button type="submit" className="btn btn-outline" style={{ padding: '0 16px' }}>+</button>
          </form>
        </section>

        {/* 86 List */}
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Item Availability</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
            Quickly "86" items to instantly hide them from your online menu.
          </p>

          <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '8px' }}>
            {items.filter(i => !i.is_special).map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ opacity: item.is_available ? 1 : 0.5, textDecoration: item.is_available ? 'none' : 'line-through', flex: 1 }}>{item.name}</span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '4px 8px' }}>
                    <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={Number(item.price).toFixed(2)}
                      onBlur={(e) => handleUpdatePrice(item, e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-light)',
                        width: '60px',
                        outline: 'none',
                        fontFamily: 'inherit'
                      }}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={item.is_available === 1}
                      onChange={() => handleToggleItem(item)}
                      style={{ accentColor: 'var(--accent-primary)', transform: 'scale(1.2)' }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
