'use client';

import React, { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import type { Door, VisitorRequest } from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { parseSafeDate } from '@/lib/date-utils';
import { formatDoorDisplayName } from '@/lib/door-status-utils';

interface VisitorRequestReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  request: VisitorRequest | null;
  doors: Door[];
  onCompleted?: () => void;
}

function generateRandomPin(length = 6): string {
  const safeLength = Math.max(4, Math.min(8, length));
  const min = Math.pow(10, safeLength - 1);
  const max = Math.pow(10, safeLength) - 1;
  const asc = '0123456789';
  const desc = '9876543210';
  let pin = '';
  do {
    pin = Math.floor(min + Math.random() * (max - min + 1)).toString();
  } while (
    asc.includes(pin) ||
    desc.includes(pin) ||
    new RegExp(`^(\\d)\\1{${safeLength - 1}}$`).test(pin)
  );
  return pin;
}

function toLocalDatetimeInputString(inputDate: unknown): string {
  const date = parseSafeDate(inputDate) || new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function VisitorRequestReviewModal({
  isOpen,
  onClose,
  orgId,
  request,
  doors,
  onCompleted,
}: VisitorRequestReviewModalProps) {
  const { role, isSuperAdmin } = useAuth();
  const isAdmin = role === 'org_admin' || isSuperAdmin;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [waitForSync, setWaitForSync] = useState(true);

  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validDoors = React.useMemo(() => {
    return doors.filter((d) => {
      const label = (d.label || '').trim();
      if (!label) return false;
      if (!isAdmin && isDoorHidden(d)) return false;
      return true;
    });
  }, [doors, isAdmin]);

  useEffect(() => {
    if (!isOpen || !request) return;
    const vd = request.visitor_data;
    setFirstName(vd?.first_name || '');
    setLastName(vd?.last_name || '');
    setEmail(vd?.email || '');
    setMobilePhone(vd?.mobile_phone || '');
    setPurpose(vd?.purpose || '');
    setPinCode(generateRandomPin(6));
    setSelectedDoorIds(vd?.requested_door_ids || []);
    setStartTime(toLocalDatetimeInputString(vd?.start_time || new Date()));
    setEndTime(toLocalDatetimeInputString(vd?.end_time || new Date(Date.now() + 4 * 60 * 60 * 1000)));
    setReviewNotes('');
    setRejectionReason('');
    setShowRejectBox(false);
    setError(null);
  }, [isOpen, request]);

  const toggleDoor = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request) return;
    setError(null);

    if (!firstName.trim()) {
      setError('First name is required.');
      return;
    }
    if (!/^\d{4,8}$/.test(pinCode.trim())) {
      setError('PIN code must be 4 to 8 numeric digits.');
      return;
    }
    if (selectedDoorIds.length === 0) {
      setError('Please select at least one authorized door.');
      return;
    }
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      setError('End time must be after start time.');
      return;
    }

    setSaving(true);
    try {
      const doorLabels = selectedDoorIds.map((id) => {
        const d = doors.find((door) => door.id === id);
        return d ? formatDoorDisplayName(d.label) : id;
      });
      const fn = httpsCallable(functions, 'approveVisitorRequest');
      await fn({
        orgId,
        requestId: request.id,
        sendEmail,
        waitForSync,
        reviewNotes: reviewNotes.trim() || undefined,
        visitor: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          mobile_phone: mobilePhone.trim(),
          purpose: purpose.trim(),
          pin_code: pinCode.trim(),
          door_ids: selectedDoorIds,
          door_labels: doorLabels,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
        },
      });
      onCompleted?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to approve visitor request.');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!request) return;
    setError(null);
    setSaving(true);
    try {
      const fn = httpsCallable(functions, 'rejectVisitorRequest');
      await fn({
        orgId,
        requestId: request.id,
        reason: rejectionReason.trim() || undefined,
      });
      onCompleted?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to reject visitor request.');
    } finally {
      setSaving(false);
    }
  };

  if (!request) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Review & Approve Visitor Request">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: 'var(--color-bg-secondary, #f1f5f9)',
            fontSize: '0.8125rem',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <span>
            <strong>Requested by:</strong> {request.requester_name || 'Unknown'} (
            {request.requester_email || 'No email'})
          </span>
          {request.visitor_data?.preset_name && (
            <span>
              <strong>Preset:</strong> {request.visitor_data.preset_name}
            </span>
          )}
          {request.visitor_data?.notes && (
            <div style={{ width: '100%', color: 'var(--color-text-secondary)' }}>
              <strong>Requester Notes:</strong> {request.visitor_data.notes}
            </div>
          )}
        </div>

        <form onSubmit={handleApprove} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label">First Name *</label>
              <input
                type="text"
                required
                className="form-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Last Name</label>
              <input
                type="text"
                className="form-input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Visitor Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Mobile Phone</label>
              <input
                type="tel"
                className="form-input"
                value={mobilePhone}
                onChange={(e) => setMobilePhone(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Purpose</label>
              <input
                type="text"
                className="form-input"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Door Access PIN (4–8 digits) *</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPinCode(generateRandomPin(6))}
                >
                  Generate
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Valid From *</label>
              <input
                type="datetime-local"
                required
                className="form-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Valid Until *</label>
              <input
                type="datetime-local"
                required
                className="form-input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="form-label">Authorized Doors *</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.4rem',
                maxHeight: '150px',
                overflowY: 'auto',
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
              }}
            >
              {validDoors.map((d) => (
                <label
                  key={d.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8125rem', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDoorIds.includes(d.id)}
                    onChange={() => toggleDoor(d.id)}
                  />
                  <span>{formatDoorDisplayName(d.label)}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.875rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              <span>Email timing, calendar invite (.ics), and PIN to visitor</span>
            </label>
            {sendEmail && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginLeft: '1.25rem', color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={waitForSync}
                  onChange={(e) => setWaitForSync(e.target.checked)}
                />
                <span>Wait for local UniFi agent sync confirmation before emailing PIN (recommended)</span>
              </label>
            )}
          </div>

          {showRejectBox && (
            <div style={{ padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-danger, #ef4444)' }}>
              <label className="form-label">Rejection Reason (sent to requester)</label>
              <textarea
                className="form-input"
                rows={2}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Optional reason for rejecting this request..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowRejectBox(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleReject}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    background: 'var(--color-danger, #ef4444)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {!showRejectBox && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ color: 'var(--color-danger, #ef4444)', borderColor: 'var(--color-danger, #ef4444)' }}
                onClick={() => setShowRejectBox(true)}
                disabled={saving}
              >
                Reject Request
              </button>
              <div style={{ display: 'flex', gap: '0.625rem' }}>
                <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Approving...' : 'Approve & Create Visitor'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
}
