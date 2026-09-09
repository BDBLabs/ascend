'use client';

import { useState, useRef, useCallback } from 'react';

const CATEGORIES = [
  { value: 'electrical', label: 'Electrical', icon: '⚡', tips: 'Panel issues, outlet failures, wiring, code violations' },
  { value: 'plumbing', label: 'Plumbing', icon: '🔧', tips: 'Leaks, drains, water heater, sewer line, fixtures' },
  { value: 'hvac', label: 'HVAC / Mechanical', icon: '❄', tips: 'Heating, cooling, ductwork, thermostat, ventilation' },
  { value: 'general', label: 'General Contracting', icon: '🔨', tips: 'Remodeling, framing, drywall, concrete, carpentry' },
] as const;

const PRIORITIES = [
  { value: 'emergency', label: 'Emergency', desc: 'Safety hazard, active leak, no power', color: '#ef4444' },
  { value: 'urgent', label: 'Urgent', desc: 'Same-day needed, system down', color: '#f59e0b' },
  { value: 'normal', label: 'Standard', desc: 'Within a few days is fine', color: '#22c55e' },
  { value: 'low', label: 'Low', desc: 'Flexible scheduling, no rush', color: '#64748b' },
] as const;

const MAX_WORK_LENGTH = 4000;
const MAX_PHOTOS = 5;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

export default function DispatchRequestPage() {
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [work, setWork] = useState('');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [priority, setPriority] = useState('normal');
  const [preferredDate, setPreferredDate] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const workLength = work.length;
  const selectedCat = CATEGORIES.find((c) => c.value === category);

  const handlePhotoAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter((f) => {
      if (f.size > 8 * 1024 * 1024) { setError(`"${f.name}" exceeds 8 MB`); return false; }
      if (!ALLOWED_TYPES.includes(f.type)) { setError(`"${f.name}" type not supported`); return false; }
      return true;
    });
    setPhotos((prev) => [...prev, ...valid].slice(0, MAX_PHOTOS));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removePhoto = useCallback((idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Step 1: Create ticket
      const res = await fetch('/api/dispatch/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          workRequired: work,
          siteLocation: location,
          contactName,
          contactEmail,
          contactPhone,
          priority,
          preferredDate: preferredDate || null,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? 'Failed to submit request.');
        return;
      }

      // Step 2: Upload photos if any
      if (photos.length > 0 && body.ticketId) {
        const formData = new FormData();
        photos.forEach((p) => formData.append('photos', p));
        await fetch(`/api/dispatch/requests/${body.ticketId}/photos`, {
          method: 'POST',
          body: formData,
        });
      }

      setTicket(body.ticketNumber);
    } catch {
      setError('Could not reach dispatch. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (ticket) {
    return (
      <section className="dispatch-section" style={{ textAlign: 'center', paddingTop: '96px' }}>
        <div className="dispatch-badge" style={{ marginBottom: '24px' }}>Request Received</div>
        <h1>Your Ticket</h1>
        <p style={{ color: '#f59e0b', fontFamily: 'ui-monospace, monospace', fontSize: '2rem', fontWeight: 900, margin: '16px 0' }}>
          {ticket}
        </p>
        <p className="subdeck" style={{ margin: '0 auto 32px' }}>
          Save this ticket number. Our dispatch team will review your request
          and send a qualified technician with a firm bid.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href={`/dispatch/track?ticket=${ticket}`} className="dispatch-btn dispatch-btn-primary">
            Track This Request
          </a>
          <a href="/dispatch/request" className="dispatch-btn dispatch-btn-secondary">
            Submit Another
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="dispatch-section">
      <h1>Submit a Service Request</h1>
      <p className="subdeck">
        Describe the work you need. Our dispatch team will send a
        qualified technician and a firm bid within the hour.
      </p>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '6px', padding: '12px', marginBottom: '20px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      <form className="dispatch-form" onSubmit={handleSubmit}>
        {/* Category */}
        <div className="dispatch-field">
          <label htmlFor="category">Service Category</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '12px', borderRadius: '6px', border: '2px solid',
                  borderColor: category === cat.value ? '#f59e0b' : '#334155',
                  background: category === cat.value ? 'rgba(245, 158, 11, 0.1)' : '#0f172a',
                  color: category === cat.value ? '#f59e0b' : '#94a3b8',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  transition: 'all 150ms',
                }}
              >
                <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
          {selectedCat && (
            <p style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>
              Common: {selectedCat.tips}
            </p>
          )}
          {!category && (
            <p style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>Select a category to continue</p>
          )}
        </div>

        {/* Priority */}
        <div className="dispatch-field">
          <label>Priority</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                style={{
                  padding: '10px 12px', borderRadius: '6px', border: '2px solid',
                  borderColor: priority === p.value ? p.color : '#334155',
                  background: priority === p.value ? `${p.color}15` : '#0f172a',
                  color: priority === p.value ? p.color : '#94a3b8',
                  cursor: 'pointer', textAlign: 'left' as const,
                  fontSize: '12px', transition: 'all 150ms',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>{p.label}</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Work Required */}
        <div className="dispatch-field">
          <label htmlFor="work">Work Required</label>
          <textarea
            id="work"
            required
            placeholder="Describe the issue or project scope..."
            value={work}
            onChange={(e) => setWork(e.target.value.slice(0, MAX_WORK_LENGTH))}
            style={{ minHeight: '120px' }}
          />
          <div style={{
            display: 'flex', justifyContent: 'flex-end', marginTop: '4px',
            fontSize: '11px', fontWeight: 600,
            color: workLength > MAX_WORK_LENGTH * 0.9 ? '#ef4444' : '#64748b',
          }}>
            {workLength.toLocaleString()} / {MAX_WORK_LENGTH.toLocaleString()}
          </div>
        </div>

        {/* Site Location */}
        <div className="dispatch-field">
          <label htmlFor="location">Site Location / Access Notes</label>
          <input
            id="location"
            type="text"
            placeholder="Address, gate code, access instructions..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        {/* Photo Upload */}
        <div className="dispatch-field">
          <label>Site Photos (optional, up to {MAX_PHOTOS})</label>
          <div
            className="dispatch-upload-area"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files);
              const valid = files.filter((f) => ALLOWED_TYPES.includes(f.type) && f.size <= 8 * 1024 * 1024);
              setPhotos((prev) => [...prev, ...valid].slice(0, MAX_PHOTOS));
            }}
          >
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
              Click to browse or drag photos here
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>
              JPEG, PNG, WebP — max 8 MB each
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            onChange={handlePhotoAdd}
            style={{ display: 'none' }}
          />
          {photos.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              {photos.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
                  padding: '4px 8px', fontSize: '11px', color: '#94a3b8',
                }}>
                  <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  <button type="button" onClick={() => removePhoto(i)} style={{
                    background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, fontSize: '14px',
                  }}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contact Info */}
        <div className="dispatch-field">
          <label>Contact Information (optional)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <input
              type="text"
              placeholder="Your name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
            <input
              type="tel"
              placeholder="Phone number"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <input
            type="email"
            placeholder="Email address"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            style={{ marginTop: '8px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {/* Preferred Date */}
        <div className="dispatch-field">
          <label htmlFor="preferred-date">Preferred Date (optional)</label>
          <input
            id="preferred-date"
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
          />
        </div>

        <button
          type="submit"
          disabled={loading || !category || !work.trim()}
          className="dispatch-btn dispatch-btn-submit"
        >
          {loading ? 'Sending...' : 'Send Request & Get Estimate'}
        </button>
      </form>
    </section>
  );
}
