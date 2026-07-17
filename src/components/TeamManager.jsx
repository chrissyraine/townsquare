import { useState, useEffect } from 'react';

// Team/roles are PIN-based (matches the house auth pattern) — each invited
// teammate sets their OWN PIN when accepting, scoped to this business + a
// role. Viewing the list needs MANAGER+; inviting/removing/role-changing is
// OWNER-only (Dashboard.jsx hides this tab entirely for STAFF sessions).
export default function TeamManager({ business }) {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', role: 'STAFF' });
  const [lastInvite, setLastInvite] = useState(null);

  const isOwner = business?.role === 'OWNER';

  const load = () => {
    fetch('/api/team', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setMembers(d.members || []))
      .catch(() => setError('You do not have access to team management.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const sendInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setLastInvite(null);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const link = `${window.location.origin}/?invite=${data.invite_code}`;
        setLastInvite({ link, name: inviteForm.name || 'this teammate' });
        setInviteForm({ name: '', role: 'STAFF' });
        load();
      }
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (id, role) => {
    await fetch(`/api/team/members/${id}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    load();
  };
  const removeMember = async (id, name) => {
    if (!window.confirm(`Remove ${name} from the team?`)) return;
    const res = await fetch(`/api/team/members/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) window.alert(data.error === 'cannot_remove_last_owner' ? 'A business must have at least one owner.' : 'Could not remove that person.');
    load();
  };

  if (loading) return <div className="animate-fade-in">Loading your team…</div>;
  if (error) return <div className="animate-fade-in glass-panel" style={{ padding: '32px', color: 'var(--text-muted)' }}>{error}</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '760px' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <div className="eyebrow">My Business</div>
        <h2>Team</h2>
        <p style={{ color: 'var(--text-muted)' }}>Who can sign in and manage {business?.name}.</p>
      </header>

      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Members</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)' }}>{m.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.last_login_at ? `Last signed in ${new Date(m.last_login_at.replace(' ', 'T') + 'Z').toLocaleDateString()}` : 'Never signed in'}</div>
              </div>
              {isOwner ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select className="input-field" style={{ padding: '6px 10px', fontSize: '0.8rem' }} value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                    <option value="OWNER">Owner</option>
                    <option value="MANAGER">Manager</option>
                    <option value="STAFF">Staff</option>
                  </select>
                  <button type="button" onClick={() => removeMember(m.id, m.name)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Remove</button>
                </div>
              ) : (
                <span style={{ fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>{m.role}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="glass-panel" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Invite a teammate</h3>
          {lastInvite && (
            <div style={{ padding: '14px 16px', marginBottom: '16px', border: '1px solid var(--border-light)', fontSize: '0.85rem' }}>
              Invitation created for {lastInvite.name}. Share this link with them — it lets them set their own PIN:
              <div style={{ marginTop: '8px', wordBreak: 'break-all', color: 'var(--accent-primary)' }}>{lastInvite.link}</div>
            </div>
          )}
          <form onSubmit={sendInvite} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="input-group" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
              <label className="input-label">Name</label>
              <input className="input-field" type="text" value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="e.g. Sam" />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">Role</label>
              <select className="input-field" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                <option value="MANAGER">Manager</option>
                <option value="STAFF">Staff</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={inviting}>{inviting ? 'Creating…' : 'Create Invite'}</button>
          </form>
        </section>
      )}
    </div>
  );
}
