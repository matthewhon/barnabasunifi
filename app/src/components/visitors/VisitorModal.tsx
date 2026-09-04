'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { UnifiVisitor, Door } from '@/lib/types';
import { format, addHours, addDays, endOfDay, setMinutes, setSeconds, setMilliseconds } from 'date-fns';

interface VisitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  visitor?: UnifiVisitor | null;
  doors: Door[];
  onSaved?: () => void;
}

function generateRandomPin(length = 6): string {
  // Generate random digits, avoiding trivially predictable sequences
  let pin = '';
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (
    pin === '123456' ||
    pin === '654321' ||
    /^(\d)\1{5}$/.test(pin)
  );
  return pin;
}

function toLocalDatetimeInputString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

export default function VisitorModal({
  isOpen,
  onClose,
  orgId,
  visitor,
  doors,
  onSaved,
}: VisitorModalProps) {
  const isEditing = Boolean(visitor?.id);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [showPin, setShowPin] = useState(true);
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visitor) {
      setFirstName(visitor.first_name || '');
      setLastName(visitor.last_name || '');
      setMobilePhone(visitor.mobile_phone || '');
      setEmail(visitor.email || '');
      setPurpose(visitor.purpose || '');
      setPinCode(visitor.pin_code || '');
      setSelectedDoorIds(visitor.door_ids || []);

      const sDate = visitor.start_time ? new Date(visitor.start_time) : new Date();
      const eDate = visitor.end_time ? new Date(visitor.end_time) : addHours(new Date(), 2);
      setStartTime(toLocalDatetimeInputString(sDate));
      setEndTime(toLocalDatetimeInputString(eDate));
    } else {
      setFirstName('');
      setLastName('');
      setMobilePhone('');
      setEmail('');
      setPurpose('');
      setPinCode(generateRandomPin(6));
      setSelectedDoorIds(doors.map((d) => d.unifi_door_id || d.id));

      const now = new Date();
      // Round to current minute
      const roundedNow = setSeconds(setMilliseconds(now, 0), 0);
      setStartTime(toLocalDatetimeInputString(roundedNow));
      setEndTime(toLocalDatetimeInputString(addHours(roundedNow, 2)));
    }
    setError(null);
  }, [visitor, doors, isOpen]);

  const handleDoorToggle = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleSelectAllDoors = () => {
    if (selectedDoorIds.length === doors.length) {
      setSelectedDoorIds([]);
    } else {
      setSelectedDoorIds(doors.map((d) => d.unifi_door_id || d.id));
    }
  };

  const handleApplyPreset = (type: '1h' | '2h' | '4h' | 'eod' | '24h' | '7d') => {
    const start = startTime ? new Date(startTime) : new Date();
    let end: Date;
    switch (type) {
      case '1h':
        end = addHours(start, 1);
        break;
      case '2h':
        end = addHours(start, 2);
        break;
      case '4h':
        end = addHours(start, 4);
        break;
      case 'eod':
        end = endOfDay(start);
        break;
      case '24h':
        end = addHours(start, 24);
        break;
      case '7d':
        end = addDays(start, 7);
        break;
    }
    setEndTime(toLocalDatetimeInputString(end));
  };

  const handleCopyPin = () => {
    if (!pinCode) return;
    navigator.clipboard.writeText(pinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!firstName.trim()) {
      setError('First name is required.');
      return;
    }
    if (selectedDoorIds.length === 0) {
      setError('Please select at least one door.');
      return;
    }
    if (!pinCode.trim() || !/^\d{4,8}$/.test(pinCode.trim())) {
      setError('PIN code must be between 4 and 8 numeric digits.');
      return;
    }
    if (!startTime || !endTime) {
      setError('Start and end times are required.');
      return;
    }

    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (endDate <= startDate) {
      setError('End time must be after start time.');
      return;
    }

    setSaving(true);
    setError(null);

    const doorLabels = doors
      .filter((d) => selectedDoorIds.includes(d.unifi_door_id || d.id))
      .map((d) => d.label);

    const payload: Partial<UnifiVisitor> = {
      id: visitor?.id,
      unifi_visitor_id: visitor?.unifi_visitor_id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      mobile_phone: mobilePhone.trim(),
      email: email.trim(),
      purpose: purpose.trim(),
      pin_code: pinCode.trim(),
      door_ids: selectedDoorIds,
      door_labels: doorLabels,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      raw_data: visitor?.raw_data,
    };

    try {
      const fn = httpsCallable(functions, 'saveUnifiVisitor');
      await fn({ orgId, visitor: payload });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save visitor.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!visitor?.id) return;
    if (!confirm(`Are you sure you want to revoke access for ${visitor.first_name} ${visitor.last_name || ''}?`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const fn = httpsCallable(functions, 'deleteUnifiVisitor');
      await fn({
        orgId,
        visitorId: visitor.id,
        unifiVisitorId: visitor.unifi_visitor_id || visitor.id,
      });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke visitor.');
    } finally {
      setDeleting(false);
    }
  };

  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      {isEditing ? (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || saving}
          style={{
            padding: '0.5rem 0.875rem',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            border: '1px solid var(--color-danger, #ef4444)',
            color: 'var(--color-danger, #ef4444)',
            cursor: deleting ? 'not-allowed' : 'pointer',
            fontSize: '0.8125rem',
            fontWeight: 500,
          }}
        >
          {deleting ? 'Revoking…' : 'Revoke Access'}
        </button>
      ) : (
        <div />
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={onClose}
          disabled={saving || deleting}
          className="btn-secondary"
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || deleting}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent, #2563eb)',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {saving ? 'Saving…' : isEditing ? 'Update Visitor' : 'Create Visitor'}
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Visitor: ${visitor?.first_name} ${visitor?.last_name || ''}` : 'Add New Visitor'}
      footer={footer}
      maxWidth="38rem"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--color-danger, #ef4444)',
              color: 'var(--color-danger, #ef4444)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Name Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
              First Name <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
            </label>
            <input
              type="text"
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g. Jane"
              style={{ width: '100%' }}
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
              Last Name
            </label>
            <input
              type="text"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="e.g. Doe"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Contact & Purpose */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
              Mobile Phone
            </label>
            <input
              type="tel"
              className="input"
              value={mobilePhone}
              onChange={(e) => setMobilePhone(e.target.value)}
              placeholder="(555) 000-0000"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
              Email
            </label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="visitor@example.com"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
            Purpose / Notes
          </label>
          <input
            type="text"
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Electrician, Guest Speaker, Worship Team"
            style={{ width: '100%' }}
          />
        </div>

        {/* PIN Code Section */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-hover, rgba(0,0,0,0.02))',
            border: '1px solid var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Door PIN Code <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
            </label>
            <button
              type="button"
              onClick={() => setPinCode(generateRandomPin(6))}
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-accent, #2563eb)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              🎲 Generate New PIN
            </button>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type={showPin ? 'text' : 'password'}
                className="input"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="4-8 digits (e.g. 849201)"
                style={{
                  width: '100%',
                  letterSpacing: showPin ? '0.2em' : 'normal',
                  fontFamily: 'monospace',
                  fontSize: '1.125rem',
                  fontWeight: 600,
                }}
                required
              />
            </div>
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              title={showPin ? 'Hide PIN' : 'Show PIN'}
              style={{
                padding: '0 0.75rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {showPin ? '👁️' : '🙈'}
            </button>
            <button
              type="button"
              onClick={handleCopyPin}
              title="Copy PIN"
              style={{
                padding: '0 0.75rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: copied ? 'rgba(34, 197, 94, 0.1)' : 'var(--color-surface)',
                color: copied ? 'var(--color-success, #22c55e)' : 'inherit',
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.375rem' }}>
            UniFi Access readers accept 4–8 digit numeric PINs for keypads.
          </span>
        </div>

        {/* Validity Time Window */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface-hover, rgba(0,0,0,0.02))',
            border: '1px solid var(--color-border)',
          }}
        >
          <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Validity Window <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>
                Valid From
              </span>
              <input
                type="datetime-local"
                className="input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={{ width: '100%' }}
                required
              />
            </div>
            <div>
              <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>
                Valid Until
              </span>
              <input
                type="datetime-local"
                className="input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={{ width: '100%' }}
                required
              />
            </div>
          </div>

          {/* Presets */}
          <div>
            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.375rem' }}>
              Quick Duration Presets:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {[
                { key: '1h', label: '+1 Hour' },
                { key: '2h', label: '+2 Hours' },
                { key: '4h', label: '+4 Hours' },
                { key: 'eod', label: 'End of Day' },
                { key: '24h', label: '+24 Hours' },
                { key: '7d', label: '+7 Days' },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handleApplyPreset(p.key as any)}
                  style={{
                    padding: '0.25rem 0.625rem',
                    fontSize: '0.75rem',
                    borderRadius: 'var(--radius-sm, 4px)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Door Assignment */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Authorized Doors <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
            </label>
            <button
              type="button"
              onClick={handleSelectAllDoors}
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-accent, #2563eb)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {selectedDoorIds.length === doors.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {doors.length === 0 ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              No doors found. Ensure your UniFi doors are synced.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
                gap: '0.5rem',
                maxHeight: '10rem',
                overflowY: 'auto',
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {doors.map((door) => {
                const doorId = door.unifi_door_id || door.id;
                const isSelected = selectedDoorIds.includes(doorId);
                return (
                  <label
                    key={doorId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.375rem 0.5rem',
                      borderRadius: 'var(--radius-sm, 4px)',
                      background: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleDoorToggle(doorId)}
                    />
                    <span style={{ fontWeight: isSelected ? 600 : 400 }}>{door.label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
