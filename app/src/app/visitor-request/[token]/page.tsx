'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { VisitorPreset } from '@/lib/types';

interface PublicDoor {
  id: string;
  label: string;
}

interface TokenMetadata {
  alreadySubmitted: boolean;
  status?: string;
  orgName?: string;
  timezone?: string;
  recipientName?: string;
  recipientEmail?: string;
  inviteNote?: string;
  expiresAt?: string;
  doors?: PublicDoor[];
  presets?: VisitorPreset[];
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PublicVisitorRequestPage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meta, setMeta] = useState<TokenMetadata | null>(null);

  // Requester info
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');

  // Visitor info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [website, setWebsite] = useState(''); // Honeypot

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Missing request token.');
      setLoading(false);
      return;
    }

    const now = new Date();
    now.setMinutes(0, 0, 0);
    const defaultStart = new Date(now.getTime() + 60 * 60 * 1000);
    const defaultEnd = new Date(defaultStart.getTime() + 4 * 60 * 60 * 1000);
    setStartTime(toLocalDatetimeInput(defaultStart));
    setEndTime(toLocalDatetimeInput(defaultEnd));

    let active = true;
    (async () => {
      try {
        const fn = httpsCallable<{ token: string }, TokenMetadata>(
          functions,
          'getVisitorRequestByToken'
        );
        const res = await fn({ token });
        if (!active) return;
        setMeta(res.data);
        if (res.data.recipientName) setRequesterName(res.data.recipientName);
        if (res.data.recipientEmail) setRequesterEmail(res.data.recipientEmail);
      } catch (err: any) {
        if (!active) return;
        setLoadError(err?.message || 'This visitor request link is invalid or has expired.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = meta?.presets?.find((p) => p.id === presetId);
    if (!preset) return;
    setSelectedDoorIds(preset.door_ids || []);
    if (!purpose.trim()) {
      setPurpose(preset.name);
    }
    if (preset.default_duration_hours && startTime) {
      const start = new Date(startTime);
      if (!isNaN(start.getTime())) {
        const end = new Date(start.getTime() + preset.default_duration_hours * 60 * 60 * 1000);
        setEndTime(toLocalDatetimeInput(end));
      }
    }
  };

  const toggleDoor = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!requesterName.trim() || !requesterEmail.includes('@')) {
      setSubmitError('Please enter your name and valid email address.');
      return;
    }
    if (!firstName.trim() || !email.includes('@')) {
      setSubmitError("Please enter the visitor's first name and valid email address.");
      return;
    }
    if (!purpose.trim()) {
      setSubmitError('Please provide the purpose of the visit.');
      return;
    }
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      setSubmitError('End time must be after start time.');
      return;
    }

    setSubmitting(true);
    try {
      const preset = meta?.presets?.find((p) => p.id === selectedPresetId);
      const fn = httpsCallable(functions, 'submitVisitorRequest');
      await fn({
        token,
        requesterName: requesterName.trim(),
        requesterEmail: requesterEmail.trim(),
        website,
        visitorData: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          mobile_phone: mobilePhone.trim(),
          purpose: purpose.trim(),
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          requested_door_ids: selectedDoorIds,
          ...(preset ? { preset_id: preset.id, preset_name: preset.name } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit visitor request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg-primary, #f8fafc)',
        color: 'var(--color-text-primary, #0f172a)',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        {loading && (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
              Loading visitor request form...
            </p>
          </div>
        )}

        {!loading && loadError && (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Link Unavailable</h1>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.9375rem' }}>
              {loadError}
            </p>
          </div>
        )}

        {!loading && !loadError && meta?.alreadySubmitted && !submitted && (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem' }}>Already Submitted</h1>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.9375rem' }}>
              This visitor request form has already been submitted (status:{' '}
              <strong>{meta.status?.replace('_', ' ')}</strong>).
            </p>
          </div>
        )}

        {submitted && (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>✅</div>
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.375rem' }}>Request Submitted</h1>
            <p
              style={{
                margin: 0,
                color: 'var(--color-text-secondary)',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
              }}
            >
              Thank you! Your visitor request for{' '}
              <strong>
                {firstName} {lastName}
              </strong>{' '}
              has been sent to <strong>{meta?.orgName}</strong> for approval. Once approved, the
              visitor will receive their access timing and door PIN via email.
            </p>
          </div>
        )}

        {!loading && !loadError && meta && !meta.alreadySubmitted && !submitted && (
          <div className="card" style={{ padding: '1.75rem' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-accent, #2563eb)',
                  marginBottom: '0.25rem',
                }}
              >
                {meta.orgName}
              </div>
              <h1 style={{ margin: '0 0 0.375rem', fontSize: '1.375rem', fontWeight: 700 }}>
                Visitor Access Request Form
              </h1>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                Fill out the visitor details below. An administrator will review and approve access,
                then email the timing and door PIN to the visitor.
              </p>
              {meta.inviteNote && (
                <div
                  style={{
                    marginTop: '0.875rem',
                    padding: '0.75rem 1rem',
                    background: 'var(--color-bg-secondary, #f1f5f9)',
                    borderLeft: '3px solid var(--color-accent, #2563eb)',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                  }}
                >
                  {meta.inviteNote}
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
              {/* Honeypot */}
              <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <div
                style={{
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--color-border)',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.875rem',
                }}
              >
                <div>
                  <label className="form-label">Your Name *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={requesterName}
                    onChange={(e) => setRequesterName(e.target.value)}
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label className="form-label">Your Email *</label>
                  <input
                    type="email"
                    required
                    className="form-input"
                    value={requesterEmail}
                    onChange={(e) => setRequesterEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.875rem',
                }}
              >
                <div>
                  <label className="form-label">Visitor First Name *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="form-label">Visitor Last Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                  />
                </div>
                <div>
                  <label className="form-label">Visitor Email (for PIN delivery) *</label>
                  <input
                    type="email"
                    required
                    className="form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="visitor@example.com"
                  />
                </div>
                <div>
                  <label className="form-label">Visitor Mobile Phone</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={mobilePhone}
                    onChange={(e) => setMobilePhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              {meta.presets && meta.presets.length > 0 && (
                <div>
                  <label className="form-label">Visit Type / Door Preset</label>
                  <select
                    className="form-input"
                    value={selectedPresetId}
                    onChange={(e) => handlePresetChange(e.target.value)}
                  >
                    <option value="">Custom / Select a preset (optional)</option>
                    {meta.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.description ? ` — ${p.description}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="form-label">Purpose of Visit *</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g., Guest Speaker, HVAC Maintenance, Facility Rental"
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.875rem',
                }}
              >
                <div>
                  <label className="form-label">Access Start Time *</label>
                  <input
                    type="datetime-local"
                    required
                    className="form-input"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Access End Time *</label>
                  <input
                    type="datetime-local"
                    required
                    className="form-input"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>

              {meta.doors && meta.doors.length > 0 && (
                <div>
                  <label className="form-label">Requested Doors (optional)</label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: '0.5rem',
                      maxHeight: '180px',
                      overflowY: 'auto',
                      padding: '0.625rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  >
                    {meta.doors.map((d) => {
                      const checked = selectedDoorIds.includes(d.id);
                      return (
                        <label
                          key={d.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.8125rem',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDoor(d.id)}
                          />
                          <span>{d.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">Additional Notes for Approver</label>
                <textarea
                  className="form-input"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special instructions or areas needed..."
                />
              </div>

              {submitError && (
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: '6px',
                    background: '#fef2f2',
                    color: '#b91c1c',
                    fontSize: '0.875rem',
                  }}
                >
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary"
                style={{
                  padding: '0.75rem 1.25rem',
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                }}
              >
                {submitting ? 'Submitting...' : 'Submit Visitor Request'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
