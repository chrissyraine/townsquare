import { useState, useEffect } from 'react';

// Read-only render of GET /api/business/preview, which is built from the SAME
// buildPublicProjection() helper the real public feed uses — so this can never
// drift from what's actually shown on titusvillesquare.com.
export default function PublicPreview() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [device, setDevice] = useState('desktop');

  useEffect(() => {
    fetch('/api/business/preview', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="animate-fade-in">Loading your preview…</div>;
  if (!data) return <div className="animate-fade-in glass-panel" style={{ padding: '32px', color: 'var(--text-muted)' }}>Could not load your preview.</div>;

  const live = data.live || {};

  return (
    <div className="animate-fade-in" style={{ maxWidth: '820px' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="eyebrow">My Business</div>
          <h2>Public Listing Preview</h2>
          <p style={{ color: 'var(--text-muted)' }}>What residents see on Titusville Square right now.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className={`btn ${device === 'desktop' ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '8px 16px', fontSize: '9px' }} onClick={() => setDevice('desktop')}>Desktop</button>
          <button type="button" className={`btn ${device === 'mobile' ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '8px 16px', fontSize: '9px' }} onClick={() => setDevice('mobile')}>Mobile</button>
        </div>
      </header>

      {!data.is_public && (
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', color: 'var(--danger)', fontSize: '0.875rem' }}>
          Your listing is currently hidden — this is a preview of what it would look like if published. Turn on "Publish my listing" in Business Profile to go live.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="glass-panel" style={{ padding: device === 'mobile' ? '20px' : '28px', width: device === 'mobile' ? '360px' : '100%', maxWidth: '520px' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
            {data.logo ? <img src={data.logo} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} /> : <div style={{ width: 56, height: 56, background: 'var(--bg-elevated)', borderRadius: 8 }} />}
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1.4rem', color: 'var(--text-main)' }}>{data.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{data.category || 'Uncategorized'}</div>
            </div>
          </div>

          {live.hours_today && (
            <div style={{ fontSize: '0.85rem', marginBottom: '8px', color: statusColor(live.hours_today.status) }}>
              {statusLabel(live.hours_today)}
            </div>
          )}
          {data.blurb && <p style={{ fontSize: '0.875rem', color: 'var(--text-soft)', marginBottom: '12px' }}>{data.blurb}</p>}
          {data.full_description && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>{data.full_description}</p>}

          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {data.address && <div>{data.address}</div>}
            {data.phone && <div>{data.phone}</div>}
            {data.price_range && <div>{data.price_range}</div>}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {data.family_friendly === true && <Badge label="Family-friendly" />}
            {data.pet_friendly === true && <Badge label="Pet-friendly" />}
            {data.appointment_required === true && <Badge label="Appointment required" />}
          </div>

          {live.announcement && (
            <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', fontSize: '0.8rem', marginBottom: '12px', borderLeft: '2px solid var(--accent-primary)' }}>
              {live.announcement}
            </div>
          )}

          {live.specials?.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '6px' }}>Today's specials</div>
              {live.specials.map((s, i) => (
                <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>{s.name}{s.price ? ` — ${s.price}` : ''}</div>
              ))}
            </div>
          )}

          {live.next_slot && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Next opening: {live.next_slot}</div>
          )}

          {typeof live.rating === 'number' && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>★ {live.rating.toFixed(1)} ({live.ratings} reviews)</div>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
            {data.links?.website && <a className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} href={data.links.website} target="_blank" rel="noreferrer">Website</a>}
            {data.links?.menu && <a className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} href={data.links.menu} target="_blank" rel="noreferrer">Menu</a>}
            {data.links?.book && <a className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '9px' }} href={data.links.book} target="_blank" rel="noreferrer">Book</a>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
        <a className="btn btn-primary" href="https://titusvillesquare.com/#dir-sec" target="_blank" rel="noreferrer">Open Live Directory ↗</a>
      </div>
    </div>
  );
}

function Badge({ label }) {
  return (
    <span style={{ fontSize: '0.65rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: '3px', padding: '2px 8px' }}>
      {label}
    </span>
  );
}

function statusColor(status) {
  if (status === 'open' || status === 'open_24h') return 'var(--success)';
  if (status === 'closed') return 'var(--danger)';
  return 'var(--text-muted)';
}
function statusLabel(hours) {
  switch (hours.status) {
    case 'open': return `Open now · ${hours.open || ''}–${hours.close || ''}`;
    case 'closed': return 'Closed now';
    case 'open_special': return 'Special hours today';
    case 'open_24h': return 'Open 24 hours';
    case 'appointment_only': return 'By appointment only';
    default: return 'Hours not set';
  }
}
