'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  getOrgSettings,
  subscribeToDoors,
  subscribeToVisitors,
} from '@/lib/firestore';
import type { Door, UnifiVisitor } from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { parseSafeDate, safeFormat } from '@/lib/date-utils';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { useToast } from '@/components/ui/Toast';
import MobileDialog from '@/components/mobile/MobileDialog';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

function extractPin(pin: unknown): string {
  if (!pin) return '';
  if (typeof pin === 'string') return pin;
  if (typeof pin === 'number') return String(pin);
  if (typeof pin === 'object' && pin !== null) {
    const obj = pin as Record<string, unknown>;
    if (typeof obj.pin_code === 'string') return obj.pin_code;
    if (typeof obj.pin === 'string') return obj.pin;
    if (typeof obj.passcode === 'string') return obj.passcode;
  }
  return '';
}

function generateSixDigitPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatVisitorRange(startIso: unknown, endIso: unknown, tz: string): string {
  const start = parseSafeDate(startIso);
  const end = parseSafeDate(endIso);
  if (!start && !end) return 'No validity window';

  const fmt = (d: Date, pattern: string) => {
    try {
      return format(toZonedTime(d, tz), pattern);
    } catch {
      return safeFormat(d, pattern);
    }
  };

  if (start && end) {
    const sameDay = fmt(start, 'yyyy-MM-dd') === fmt(end, 'yyyy-MM-dd');
    if (sameDay) {
      return `${fmt(start, 'MMM d')} · ${fmt(start, 'h:mm a')} – ${fmt(end, 'h:mm a')}`;
    }
    return `${fmt(start, 'MMM d, h:mm a')} – ${fmt(end, 'MMM d, h:mm a')}`;
  }
  if (start) return `From ${fmt(start, 'MMM d, h:mm a')}`;
  return `Until ${fmt(end!, 'MMM d, h:mm a')}`;
}

function statusBadgeClass(status: unknown): string {
  switch (String(status)) {
    case 'active':
      return 'badge-success';
    case 'upcoming':
      return 'badge-info';
    case 'revoked':
      return 'badge-danger';
    case 'pending':
      return 'badge-warning';
    default:
      return 'badge-neutral';
  }
}

export default function MobileVisitorsPage() {
  const { orgId, role } = useAuth();
  const { showToast } = useToast();
  const formId = useId();

  const canManage = role === 'org_admin' || role === 'manager' || role === 'super_admin';

  const [visitors, setVisitors] = useState<UnifiVisitor[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [timezone, setTimezone] = useState<string>('America/Chicago');
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'current' | 'all' | 'past'>('current');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create/Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVisitor, setEditingVisitor] = useState<UnifiVisitor | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    let firstLoad = true;

    const unsubVisitors = subscribeToVisitors(orgId, (list) => {
      setVisitors(list);
      if (firstLoad) {
        firstLoad = false;
        setLoading(false);
      }
    });
    const unsubDoors = subscribeToDoors(orgId, setDoors);
    getOrgSettings(orgId)
      .then((s) => {
        if (s?.timezone) setTimezone(s.timezone);
      })
      .catch(() => {});

    return () => {
      unsubVisitors();
      unsubDoors();
    };
  }, [orgId]);

  const visibleDoors = useMemo(() => doors.filter((d) => !isDoorHidden(d)), [doors]);

  const filteredVisitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visitors.filter((v) => {
      const status = String(v.status || '');
      const isCurrent = status === 'active' || status === 'upcoming' || status === 'pending';
      if (filter === 'current' && !isCurrent) return false;
      if (filter === 'past' && isCurrent) return false;
      if (q) {
        const hay = `${v.first_name} ${v.last_name ?? ''} ${v.email ?? ''} ${
          v.purpose ?? ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visitors, filter, search]);

  const applyPreset = (hours: number | 'today') => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    if (hours === 'today') {
      end.setHours(23, 59, 0, 0);
      if (end <= start) end.setDate(end.getDate() + 1);
    } else {
      end.setTime(start.getTime() + hours * 60 * 60 * 1000);
    }
    setStartTime(toDatetimeLocalValue(start));
    setEndTime(toDatetimeLocalValue(end));
  };

  const openCreateModal = () => {
    setEditingVisitor(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setMobilePhone('');
    setPurpose('');
    setPinCode(generateSixDigitPin());
    applyPreset(2);
    setSelectedDoorIds([]);
    setFormError(null);
    setConfirmRevoke(false);
    setModalOpen(true);
  };

  const openEditModal = (v: UnifiVisitor) => {
    setEditingVisitor(v);
    setFirstName(v.first_name || '');
    setLastName(v.last_name || '');
    setEmail(v.email || '');
    setMobilePhone(v.mobile_phone || '');
    setPurpose(v.purpose || '');
    setPinCode(extractPin(v.pin_code) || generateSixDigitPin());
    const start = parseSafeDate(v.start_time) || new Date();
    const end = parseSafeDate(v.end_time) || new Date(Date.now() + 2 * 60 * 60 * 1000);
    setStartTime(toDatetimeLocalValue(start));
    setEndTime(toDatetimeLocalValue(end));
    setSelectedDoorIds(v.door_ids || []);
    setFormError(null);
    setConfirmRevoke(false);
    setModalOpen(true);
  };

  const toggleDoor = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleCopyPin = async (visitorId: string, pin: string) => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopiedId(visitorId);
      showToast(`Copied PIN ${pin}`, 'success');
      setTimeout(() => setCopiedId((cur) => (cur === visitorId ? null : cur)), 2000);
    } catch {
      showToast('Could not copy PIN to clipboard.', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !canManage) return;

    if (!firstName.trim()) {
      setFormError('First name is required.');
      return;
    }
    if (!/^\d{4,8}$/.test(pinCode.trim())) {
      setFormError('PIN code must be 4 to 8 digits.');
      return;
    }
    if (!startTime || !endTime) {
      setFormError('Start and end times are required.');
      return;
    }
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
      setFormError('End time must be after start time.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const doorLabels = visibleDoors
      .filter((d) => selectedDoorIds.includes(d.unifi_door_id || d.id))
      .map((d) => d.label);

    const payload: Partial<UnifiVisitor> = {
      id: editingVisitor?.id,
      unifi_visitor_id: editingVisitor?.unifi_visitor_id,
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
      raw_data: editingVisitor?.raw_data,
    };

    try {
      const fn = httpsCallable(functions, 'saveUnifiVisitor');
      await fn({ orgId, visitor: payload });
      showToast(
        editingVisitor
          ? `Updated visitor ${firstName.trim()}`
          : `Created visitor ${firstName.trim()} (PIN: ${pinCode.trim()})`,
        'success'
      );
      setModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save visitor.';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async () => {
    if (!orgId || !editingVisitor?.id) return;
    setDeleting(true);
    setFormError(null);
    try {
      const fn = httpsCallable(functions, 'deleteUnifiVisitor');
      await fn({
        orgId,
        visitorId: editingVisitor.id,
        unifiVisitorId: editingVisitor.unifi_visitor_id,
      });
      showToast(`Revoked access for ${editingVisitor.first_name}`, 'success');
      setModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke visitor.';
      setFormError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.2 }}>Visitors</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.125rem' }}>
            Temporary PIN access for guests &amp; contractors
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            className="mobile-touch-btn"
            onClick={openCreateModal}
            style={{
              background: 'var(--color-accent)',
              color: '#ffffff',
              padding: '0 0.875rem',
              fontSize: '0.875rem',
            }}
          >
            <Plus size={18} />
            <span>New</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search
          size={18}
          style={{
            position: 'absolute',
            left: '0.875rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          aria-label="Search visitors"
          placeholder="Search name, email, or purpose…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mobile-input"
          style={{ paddingLeft: '2.625rem' }}
          enterKeyHint="search"
        />
      </div>

      {/* Filter Pills */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={filter === 'current'}
          onClick={() => setFilter('current')}
        >
          Active &amp; Upcoming
        </button>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All ({visitors.length})
        </button>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={filter === 'past'}
          onClick={() => setFilter('past')}
        >
          Past / Revoked
        </button>
      </div>

      {/* Visitors List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
          <LoadingSpinner />
        </div>
      ) : filteredVisitors.length === 0 ? (
        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            padding: '2rem 1.25rem',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Users size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.25rem' }}>
            No visitors found
          </p>
          <p style={{ fontSize: '0.8125rem', marginBottom: canManage ? '1rem' : 0 }}>
            {search ? 'Try a different search term.' : 'Create a visitor to issue a temporary door PIN.'}
          </p>
          {canManage && !search && (
            <button
              type="button"
              className="mobile-touch-btn"
              onClick={openCreateModal}
              style={{ background: 'var(--color-accent)', color: '#fff', width: '100%' }}
            >
              <UserPlus size={18} />
              <span>Create Visitor</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredVisitors.map((v) => {
            const pin = extractPin(v.pin_code);
            const fullName =
              v.full_name || `${v.first_name || ''} ${v.last_name || ''}`.trim() || 'Visitor';
            const doorCount = v.door_labels?.length || v.door_ids?.length || 0;

            return (
              <article
                key={v.id}
                style={{
                  background: 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-xl)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.625rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div style={{ minWidth: 0 }}>
                    <h2
                      style={{
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {fullName}
                    </h2>
                    {v.purpose && (
                      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                        {v.purpose}
                      </p>
                    )}
                  </div>
                  <span className={`badge ${statusBadgeClass(v.status)}`} style={{ flexShrink: 0 }}>
                    {v.status || 'unknown'}
                  </span>
                </div>

                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  {formatVisitorRange(v.start_time, v.end_time, timezone)}
                </div>

                {/* Door Chips */}
                {doorCount > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                    {(v.door_labels && v.door_labels.length > 0
                      ? v.door_labels
                      : [`${doorCount} door${doorCount === 1 ? '' : 's'}`]
                    ).map((label) => (
                      <span
                        key={label}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.1875rem 0.5rem',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--color-bg-elevated)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}

                {/* PIN & Edit Actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    paddingTop: '0.25rem',
                  }}
                >
                  {pin && (
                    <button
                      type="button"
                      className="mobile-touch-btn"
                      onClick={() => handleCopyPin(v.id, pin)}
                      style={{
                        flex: 1,
                        minHeight: '44px',
                        background: 'var(--color-bg-base)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                        justifyContent: 'space-between',
                        padding: '0 0.875rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <KeyRound size={15} style={{ color: 'var(--color-accent-hover)' }} />
                        <span style={{ fontFamily: 'monospace', letterSpacing: '0.1em', fontWeight: 700 }}>
                          {pin}
                        </span>
                      </span>
                      {copiedId === v.id ? (
                        <Check size={16} style={{ color: 'var(--color-success)' }} />
                      ) : (
                        <Copy size={15} style={{ color: 'var(--color-text-secondary)' }} />
                      )}
                    </button>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      className="mobile-touch-btn"
                      onClick={() => openEditModal(v)}
                      style={{
                        minHeight: '44px',
                        padding: '0 1rem',
                        background: 'var(--color-bg-elevated)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text-primary)',
                        fontSize: '0.875rem',
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Create / Edit Visitor Dialog */}
      <MobileDialog
        open={modalOpen}
        onClose={() => {
          if (!saving && !deleting) setModalOpen(false);
        }}
        title={editingVisitor ? 'Edit Visitor' : 'Create Visitor'}
        subtitle="Issue a temporary PIN for selected doors."
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {formError && (
            <div className="alert alert-danger" role="alert">
              <span>{formError}</span>
            </div>
          )}

          {/* Name row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
            <div>
              <label
                htmlFor={`${formId}-first`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                First Name *
              </label>
              <input
                id={`${formId}-first`}
                name="first_name"
                type="text"
                required
                autoComplete="given-name"
                enterKeyHint="next"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  if (formError) setFormError(null);
                }}
                className="mobile-input"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-last`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                Last Name
              </label>
              <input
                id={`${formId}-last`}
                name="last_name"
                type="text"
                autoComplete="family-name"
                enterKeyHint="next"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mobile-input"
              />
            </div>
          </div>

          {/* PIN Code */}
          <div>
            <label
              htmlFor={`${formId}-pin`}
              style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
            >
              Door PIN Code (4–8 digits) *
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                id={`${formId}-pin`}
                name="pin_code"
                type="text"
                inputMode="numeric"
                pattern="\d{4,8}"
                required
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={pinCode}
                onChange={(e) => {
                  setPinCode(e.target.value.replace(/\D/g, '').slice(0, 8));
                  if (formError) setFormError(null);
                }}
                className="mobile-input"
                style={{ fontFamily: 'monospace', letterSpacing: '0.15em', fontWeight: 700 }}
              />
              <button
                type="button"
                className="mobile-touch-btn"
                onClick={() => setPinCode(generateSixDigitPin())}
                aria-label="Generate random PIN"
                style={{
                  background: 'var(--color-bg-elevated)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-primary)',
                  flexShrink: 0,
                }}
              >
                <RefreshCw size={16} />
                <span>New</span>
              </button>
            </div>
          </div>

          {/* Quick Time Presets */}
          <div>
            <span style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
              Quick Duration
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.125rem' }}>
              <button type="button" className="mobile-pill" onClick={() => applyPreset(2)}>
                2 Hours
              </button>
              <button type="button" className="mobile-pill" onClick={() => applyPreset('today')}>
                Rest of Today
              </button>
              <button type="button" className="mobile-pill" onClick={() => applyPreset(24)}>
                24 Hours
              </button>
              <button type="button" className="mobile-pill" onClick={() => applyPreset(24 * 7)}>
                7 Days
              </button>
            </div>
          </div>

          {/* Start & End Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.625rem' }}>
            <div>
              <label
                htmlFor={`${formId}-start`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                Starts At *
              </label>
              <input
                id={`${formId}-start`}
                name="start_time"
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mobile-input"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-end`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                Ends At *
              </label>
              <input
                id={`${formId}-end`}
                name="end_time"
                type="datetime-local"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mobile-input"
              />
            </div>
          </div>

          {/* Purpose, Email, Phone */}
          <div>
            <label
              htmlFor={`${formId}-purpose`}
              style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
            >
              Purpose / Notes
            </label>
            <input
              id={`${formId}-purpose`}
              name="purpose"
              type="text"
              placeholder="e.g. Guest Speaker, HVAC Contractor"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="mobile-input"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
            <div>
              <label
                htmlFor={`${formId}-email`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                Email
              </label>
              <input
                id={`${formId}-email`}
                name="email"
                type="email"
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mobile-input"
              />
            </div>

            <div>
              <label
                htmlFor={`${formId}-phone`}
                style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}
              >
                Mobile Phone
              </label>
              <input
                id={`${formId}-phone`}
                name="mobile_phone"
                type="tel"
                autoComplete="tel"
                value={mobilePhone}
                onChange={(e) => setMobilePhone(e.target.value)}
                className="mobile-input"
              />
            </div>
          </div>

          {/* Door Access Checkboxes */}
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '0.375rem',
              }}
            >
              <legend style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Door Access ({selectedDoorIds.length} selected)
              </legend>
              {visibleDoors.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDoorIds(
                      selectedDoorIds.length === visibleDoors.length
                        ? []
                        : visibleDoors.map((d) => d.unifi_door_id || d.id)
                    )
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-accent-hover)',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {selectedDoorIds.length === visibleDoors.length ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
                maxHeight: '11rem',
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '0.5rem',
                background: 'var(--color-bg-base)',
              }}
            >
              {visibleDoors.length === 0 ? (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', padding: '0.5rem' }}>
                  No doors available.
                </p>
              ) : (
                visibleDoors.map((door) => {
                  const targetId = door.unifi_door_id || door.id;
                  const checked = selectedDoorIds.includes(targetId);
                  return (
                    <label
                      key={door.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.625rem',
                        minHeight: '44px',
                        padding: '0.375rem 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        background: checked ? 'rgba(36, 101, 245, 0.12)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDoor(targetId)}
                        style={{
                          width: '1.125rem',
                          height: '1.125rem',
                          accentColor: 'var(--color-accent)',
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                        {door.label}
                        {door.campus_name ? (
                          <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                            {' '}
                            · {door.campus_name}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </fieldset>

          {/* Submit / Revoke */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginTop: '0.25rem' }}>
            <button
              type="submit"
              className="mobile-touch-btn"
              disabled={saving || deleting}
              style={{
                background: 'var(--color-accent)',
                color: '#ffffff',
                width: '100%',
              }}
            >
              {saving ? 'Saving…' : editingVisitor ? 'Save Changes' : 'Create Visitor'}
            </button>

            {editingVisitor && (
              !confirmRevoke ? (
                <button
                  type="button"
                  className="mobile-touch-btn"
                  disabled={saving || deleting}
                  onClick={() => setConfirmRevoke(true)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    borderColor: 'rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    width: '100%',
                  }}
                >
                  <Trash2 size={16} />
                  <span>Revoke Visitor Access</span>
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="mobile-touch-btn"
                    disabled={deleting}
                    onClick={() => setConfirmRevoke(false)}
                    style={{
                      flex: 1,
                      background: 'var(--color-bg-elevated)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="mobile-touch-btn"
                    disabled={deleting}
                    onClick={handleRevoke}
                    style={{
                      flex: 1,
                      background: 'var(--color-danger)',
                      color: '#ffffff',
                    }}
                  >
                    {deleting ? 'Revoking…' : 'Confirm Revoke'}
                  </button>
                </div>
              )
            )}
          </div>
        </form>
      </MobileDialog>
    </div>
  );
}
