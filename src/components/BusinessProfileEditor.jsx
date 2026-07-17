import { useState, useEffect } from 'react';

const BLANK = {
  name: '', category: '', blurb: '', full_description: '', secondary_categories: [],
  address: '', service_area: '', phone: '', email: '', website: '',
  public_contact_preference: '', social_links: { facebook: '', instagram: '', other: '' },
  price_range: '', accessibility_info: '', parking_info: '',
  family_friendly: null, pet_friendly: null, appointment_required: null,
  service_notes: '', logo: '', primary_color: '', is_public: false,
};

const REQUIRED_FOR_COMPLETION = ['name', 'category', 'blurb', 'address', 'phone', 'logo'];

// Full yellow-pages profile editor. Read-only for STAFF sessions (they can post
// day-to-day updates elsewhere, but not change core business details, per role
// spec). Follows HeraldModule.jsx's local-state / handleSave / save-confirmation
// pattern rather than inventing a new form convention.
export default function BusinessProfileEditor({ business }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [lastSaved, setLastSaved] = useState(null);

  const readOnly = business?.role === 'STAFF';

  useEffect(() => {
    fetch('/api/business/profile', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setForm({
          ...BLANK, ...d,
          secondary_categories: Array.isArray(d.secondary_categories) ? d.secondary_categories : [],
          social_links: { facebook: '', instagram: '', other: '', ...(d.social_links || {}) },
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setSocial = (key, value) => setForm((f) => ({ ...f, social_links: { ...f.social_links, [key]: value } }));

  const completion = Math.round(
    (REQUIRED_FOR_COMPLETION.filter((k) => form[k] && String(form[k]).trim()).length / REQUIRED_FOR_COMPLETION.length) * 100
  );
  const missing = REQUIRED_FOR_COMPLETION.filter((k) => !form[k] || !String(form[k]).trim());

  const handleSave = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/profile', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Profile saved.' });
        setLastSaved(new Date());
      } else {
        setMessage({ type: 'error', text: 'Could not save. Please try again.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) return <div className="animate-fade-in">Loading your profile…</div>;

  return (
    <div className="animate-fade-in" style={{ maxWidth: '820px' }}>
      <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div className="eyebrow">My Business</div>
          <h2>Business Profile</h2>
          <p style={{ color: 'var(--text-muted)' }}>What customers see on your Titusville Square listing.</p>
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <div>{completion}% complete</div>
          {lastSaved && <div>Saved {lastSaved.toLocaleTimeString()}</div>}
        </div>
      </header>

      {readOnly && (
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          You have view-only access to the business profile. Ask an owner or manager to make changes.
        </div>
      )}

      {missing.length > 0 && (
        <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', fontSize: '0.875rem', color: 'var(--text-soft)' }}>
          Missing: {missing.join(', ')}
        </div>
      )}

      <form onSubmit={handleSave}>
        <fieldset disabled={readOnly || saving} style={{ border: 'none', padding: 0, margin: 0 }}>
          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Basic Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <Field label="Business name" value={form.name} onChange={(v) => set('name', v)} />
              <Field label="Category" value={form.category} onChange={(v) => set('category', v)} />
              <Field label="Phone" value={form.phone} onChange={(v) => set('phone', v)} />
              <Field label="Email" value={form.email} onChange={(v) => set('email', v)} type="email" />
              <Field label="Website" value={form.website} onChange={(v) => set('website', v)} />
              <Field label="Address" value={form.address} onChange={(v) => set('address', v)} />
              <Field label="Service area" value={form.service_area} onChange={(v) => set('service_area', v)} />
              <SelectField label="Preferred contact method" value={form.public_contact_preference} onChange={(v) => set('public_contact_preference', v)}
                options={[['', 'Not set'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['visit', 'In person']]} />
            </div>
            <TextAreaField label="Short description" value={form.blurb} onChange={(v) => set('blurb', v)} rows={2} style={{ marginTop: '16px' }} />
            <TextAreaField label="Full description" value={form.full_description} onChange={(v) => set('full_description', v)} rows={5} style={{ marginTop: '16px' }} />
          </section>

          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Social Links</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <Field label="Facebook" value={form.social_links.facebook} onChange={(v) => setSocial('facebook', v)} />
              <Field label="Instagram" value={form.social_links.instagram} onChange={(v) => setSocial('instagram', v)} />
              <Field label="Other" value={form.social_links.other} onChange={(v) => setSocial('other', v)} />
            </div>
          </section>

          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Public Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <SelectField label="Price range" value={form.price_range} onChange={(v) => set('price_range', v)}
                options={[['', 'Not set'], ['$', '$'], ['$$', '$$'], ['$$$', '$$$'], ['$$$$', '$$$$']]} />
              <TriToggle label="Family-friendly" value={form.family_friendly} onChange={(v) => set('family_friendly', v)} />
              <TriToggle label="Pet-friendly" value={form.pet_friendly} onChange={(v) => set('pet_friendly', v)} />
              <TriToggle label="Appointment required" value={form.appointment_required} onChange={(v) => set('appointment_required', v)} />
            </div>
            <Field label="Accessibility info" value={form.accessibility_info} onChange={(v) => set('accessibility_info', v)} style={{ marginTop: '16px' }} />
            <Field label="Parking info" value={form.parking_info} onChange={(v) => set('parking_info', v)} style={{ marginTop: '16px' }} />
            <TextAreaField label="Service notes" value={form.service_notes} onChange={(v) => set('service_notes', v)} rows={2} style={{ marginTop: '16px' }} />
          </section>

          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Media</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
              Paste a link to an image you've already uploaded somewhere (direct photo upload is coming soon).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <Field label="Logo URL" value={form.logo} onChange={(v) => set('logo', v)} />
              <Field label="Brand color" value={form.primary_color} onChange={(v) => set('primary_color', v)} placeholder="#C8A96A" />
            </div>
          </section>

          <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: readOnly ? 'default' : 'pointer', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={!!form.is_public} onChange={(e) => set('is_public', e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
              Publish my listing on Titusville Square
            </label>
          </section>
        </fieldset>

        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
            {message && (
              <span style={{ color: message.type === 'error' ? 'var(--danger)' : 'var(--success)', fontSize: '0.875rem' }}>{message.text}</span>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', style, placeholder }) {
  return (
    <div className="input-group" style={{ marginBottom: 0, ...style }}>
      <label className="input-label">{label}</label>
      <input className="input-field" type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function TextAreaField({ label, value, onChange, rows, style }) {
  return (
    <div className="input-group" style={{ marginBottom: 0, ...style }}>
      <label className="input-label">{label}</label>
      <textarea className="input-field" rows={rows} value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ resize: 'vertical' }} />
    </div>
  );
}
function SelectField({ label, value, onChange, options }) {
  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label className="input-label">{label}</label>
      <select className="input-field" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
function TriToggle({ label, value, onChange }) {
  // value: null (never answered) | 0 (no) | 1 (yes)
  return (
    <div className="input-group" style={{ marginBottom: 0 }}>
      <label className="input-label">{label}</label>
      <select className="input-field" value={value === null || value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Not set</option>
        <option value="1">Yes</option>
        <option value="0">No</option>
      </select>
    </div>
  );
}
