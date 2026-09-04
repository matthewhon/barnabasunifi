'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  subscribeToVisitors,
  subscribeToDoors,
  getOrgSettings,
} from '@/lib/firestore';
import type { UnifiVisitor, Door, VisitorStatus } from '@/lib/types';
import VisitorModal from '@/components/visitors/VisitorModal';
import { format, isPast, isFuture, formatDistanceToNow } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// ─── Icons ────────────────────────────────────────────────────────────────────

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: spinning ? 'spin 1s linear infinite' : 'none',
      }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeClass(status: VisitorStatus): string {
  switch (status) {
    case 'active': return 'badge-success';
    case 'upcoming': return 'badge-info';
    case 'expired': return 'badge-neutral';
    case 'revoked': return 'badge-danger';
    case 'pending': return 'badge-warning';
    default: return 'badge-neutral';
  }
}

function formatVisitorTime(iso: string, tz: string): string {
  try {
    const zoned = toZonedTime(new Date(iso), tz);
    return format(zoned, 'MMM d, yyyy · h:mm a');
  } catch {
    return format(new Date(iso), 'MMM d, yyyy · h:mm a');
  }
}

function getValidityNotice(visitor: UnifiVisitor): { text: string; color: string } {
  if (visitor.status === 'revoked') {
    return { text: 'Access Revoked', color: 'var(--color-danger, #ef4444)' };
  }

  const now = new Date();
  const start = new Date(visitor.start_time);
  const end = new Date(visitor.end_time);

  if (isFuture(start)) {
    return {
      text: `Starts in ${formatDistanceToNow(start)}`,
      color: 'var(--color-info, #3b82f6)',
    };
  }

  if (isPast(end)) {
    return {
      text: `Expired ${formatDistanceToNow(end)} ago`,
      color: 'var(--color-text-secondary)',
    };
  }

  return {
    text: `Valid now · Ends in ${formatDistanceToNow(end)}`,
    color: 'var(--color-success, #22c55e)',
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = 'active' | 'upcoming' | 'expired' | 'revoked' | 'all';

export default function VisitorsPage() {
  const { orgId, role, isSuperAdmin } = useAuth();
  const canManage = role === 'org_admin' || role === 'manager' || isSuperAdmin;

  const [visitors, setVisitors] = useState<UnifiVisitor[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [timezone, setTimezone] = useState('America/Chicago');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('active');
  const [doorFilter, setDoorFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVisitor, setEditingVisitor] = useState<UnifiVisitor | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showFeedback = useCallback((text: string, ok: boolean) => {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Load Org Timezone & Subscriptions
  useEffect(() => {
    if (!orgId) return;

    getOrgSettings(orgId).then((settings) => {
      if (settings?.timezone) {
        setTimezone(settings.timezone);
      }
    });

    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));
    const unsubVisitors = subscribeToVisitors(orgId, (v) => {
      setVisitors(v);
      setLoading(false);
    });

    return () => {
      unsubDoors();
      unsubVisitors();
    };
  }, [orgId]);

  // Sync from UniFi
  const handleSync = async () => {
    if (!orgId || syncing) return;
    setSyncing(true);
    try {
      const fn = httpsCallable(functions, 'syncUnifiVisitors');
      const res: any = await fn({ orgId });
      const mode = res.data?.mode;
      const count = res.data?.count;
      if (mode === 'remote') {
        showFeedback(`Synced ${count ?? 0} visitor(s) from UniFi Access.`, true);
      } else {
        showFeedback('Sync command dispatched to local agent.', true);
      }
    } catch (err: any) {
      showFeedback(err.message || 'Failed to sync visitors.', false);
    } finally {
      setSyncing(false);
    }
  };

  // Revoke visitor directly
  const handleRevoke = async (visitor: UnifiVisitor) => {
    if (!orgId) return;
    if (!confirm(`Are you sure you want to revoke access for ${visitor.first_name} ${visitor.last_name || ''}?`)) {
      return;
    }
    try {
      const fn = httpsCallable(functions, 'deleteUnifiVisitor');
      await fn({
        orgId,
        visitorId: visitor.id,
        unifiVisitorId: visitor.unifi_visitor_id || visitor.id,
      });
      showFeedback(`Revoked access for ${visitor.first_name}.`, true);
    } catch (err: any) {
      showFeedback(err.message || 'Failed to revoke visitor.', false);
    }
  };

  // Quick Copy Access Info
  const handleCopyAccessInfo = (visitor: UnifiVisitor) => {
    const doorNames = visitor.door_labels?.join(', ') || 'assigned doors';
    const validUntilFormatted = formatVisitorTime(visitor.end_time, timezone);
    const validFromFormatted = formatVisitorTime(visitor.start_time, timezone);
    const text = `Hi ${visitor.first_name}, here is your UniFi Access door PIN: ${visitor.pin_code}. It is valid for ${doorNames} from ${validFromFormatted} to ${validUntilFormatted}.`;

    navigator.clipboard.writeText(text);
    setCopiedId(visitor.id);
    showFeedback(`Copied invitation details for ${visitor.first_name} to clipboard!`, true);
    setTimeout(() => setCopiedId(null), 3000);
  };

  // Quick Copy PIN only
  const handleCopyPinOnly = (visitor: UnifiVisitor) => {
    if (!visitor.pin_code) return;
    navigator.clipboard.writeText(visitor.pin_code);
    setCopiedId(`pin_${visitor.id}`);
    showFeedback(`Copied PIN ${visitor.pin_code} to clipboard!`, true);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Filtered Visitors
  const filteredVisitors = useMemo(() => {
    return visitors.filter((v) => {
      // Tab filter
      if (tab !== 'all' && v.status !== tab) return false;

      // Door filter
      if (doorFilter !== 'all' && !v.door_ids.includes(doorFilter)) return false;

      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const fullName = `${v.first_name} ${v.last_name || ''}`.toLowerCase();
        const purpose = (v.purpose || '').toLowerCase();
        const phone = (v.mobile_phone || '').toLowerCase();
        const email = (v.email || '').toLowerCase();
        const doorNames = (v.door_labels || []).join(' ').toLowerCase();

        return (
          fullName.includes(q) ||
          purpose.includes(q) ||
          phone.includes(q) ||
          email.includes(q) ||
          doorNames.includes(q)
        );
      }

      return true;
    });
  }, [visitors, tab, doorFilter, search]);

  // Counts
  const counts = useMemo(() => {
    return {
      active: visitors.filter((v) => v.status === 'active').length,
      upcoming: visitors.filter((v) => v.status === 'upcoming').length,
      expired: visitors.filter((v) => v.status === 'expired').length,
      revoked: visitors.filter((v) => v.status === 'revoked').length,
      all: visitors.length,
    };
  }, [visitors]);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 className="page-title">Visitors</h1>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
            Create guest access, generate door PIN codes, and configure time validity windows for UniFi Access.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.875rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              cursor: syncing ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
            }}
          >
            <RefreshIcon spinning={syncing} />
            <span>{syncing ? 'Syncing…' : 'Sync from UniFi'}</span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={() => {
                setEditingVisitor(null);
                setModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent, #2563eb)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              <PlusIcon />
              <span>Add Visitor</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`alert ${feedback.ok ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.25rem' }}
        >
          {feedback.text}
        </div>
      )}

      {/* Metrics Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Active Now
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--color-success, #22c55e)' }}>
            {counts.active}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Upcoming
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--color-info, #3b82f6)' }}>
            {counts.upcoming}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Expired
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--color-text-secondary)' }}>
            {counts.expired}
          </div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Total Managed
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {counts.all}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
            padding: '0.25rem',
            borderRadius: 'var(--radius-md)',
            gap: '0.25rem',
          }}
        >
          {(
            [
              { key: 'active', label: `Active (${counts.active})` },
              { key: 'upcoming', label: `Upcoming (${counts.upcoming})` },
              { key: 'expired', label: `Expired (${counts.expired})` },
              { key: 'revoked', label: `Revoked (${counts.revoked})` },
              { key: 'all', label: `All (${counts.all})` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: 'var(--radius-sm, 4px)',
                border: 'none',
                background: tab === t.key ? 'var(--color-surface, #fff)' : 'transparent',
                color: tab === t.key ? 'var(--color-text)' : 'var(--color-text-secondary)',
                fontWeight: tab === t.key ? 600 : 400,
                fontSize: '0.8125rem',
                cursor: 'pointer',
                boxShadow: tab === t.key ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search & Door Dropdown */}
        <div style={{ display: 'flex', gap: '0.5rem', flex: 1, maxWidth: '28rem' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <span
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                opacity: 0.5,
                pointerEvents: 'none',
              }}
            >
              <SearchIcon />
            </span>
            <input
              type="text"
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search visitor, phone, door…"
              style={{ paddingLeft: '2.25rem', width: '100%', fontSize: '0.875rem' }}
            />
          </div>

          <select
            className="input"
            value={doorFilter}
            onChange={(e) => setDoorFilter(e.target.value)}
            style={{ width: 'auto', fontSize: '0.8125rem' }}
          >
            <option value="all">All Doors</option>
            {doors.map((d) => (
              <option key={d.id} value={d.unifi_door_id || d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Visitors Content */}
      {loading ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            Loading visitors…
          </p>
        </div>
      ) : filteredVisitors.length === 0 ? (
        <div className="card" style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎟️</div>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem' }}>No visitors found</h3>
          <p style={{ margin: '0 0 1.25rem', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
            {visitors.length === 0
              ? 'No visitors have been added yet. Create one or sync from UniFi Access.'
              : 'No visitors match the current filter or search criteria.'}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setEditingVisitor(null);
                setModalOpen(true);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent, #2563eb)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              <PlusIcon />
              <span>Add First Visitor</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredVisitors.map((visitor) => {
            const notice = getValidityNotice(visitor);
            const isPinCopied = copiedId === `pin_${visitor.id}`;
            const isTextCopied = copiedId === visitor.id;

            return (
              <div
                key={visitor.id}
                className="card"
                style={{
                  padding: '1.25rem',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(14rem, 1.2fr) minmax(12rem, 1.2fr) minmax(10rem, 1fr) auto',
                  alignItems: 'center',
                  gap: '1.25rem',
                }}
              >
                {/* 1. Name & Contact */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '1rem' }}>
                      {visitor.first_name} {visitor.last_name || ''}
                    </span>
                    <span className={`badge ${statusBadgeClass(visitor.status)}`} style={{ textTransform: 'capitalize' }}>
                      {visitor.status}
                    </span>
                    {visitor.sync_status === 'pending' && (
                      <span className="badge badge-warning" title="Syncing to UniFi Access…">
                        Syncing…
                      </span>
                    )}
                  </div>

                  {visitor.purpose && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-accent, #2563eb)', marginTop: '0.25rem', fontWeight: 500 }}>
                      {visitor.purpose}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                    {visitor.mobile_phone && <span>📞 {visitor.mobile_phone}</span>}
                    {visitor.email && <span>✉️ {visitor.email}</span>}
                  </div>

                  {/* Doors assigned */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
                    {(visitor.door_labels || []).length > 0 ? (
                      visitor.door_labels?.map((label, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '0.6875rem',
                            padding: '0.125rem 0.375rem',
                            borderRadius: 'var(--radius-sm, 4px)',
                            background: 'var(--color-surface-hover, rgba(0,0,0,0.05))',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          🚪 {label}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        No doors assigned
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. Validity Window */}
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: notice.color, marginBottom: '0.25rem' }}>
                    ● {notice.text}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    <div>From: {formatVisitorTime(visitor.start_time, timezone)}</div>
                    <div>Until: {formatVisitorTime(visitor.end_time, timezone)}</div>
                  </div>
                </div>

                {/* 3. PIN Code & Sharing */}
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>
                    PIN Code
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '1.125rem',
                        fontWeight: 700,
                        letterSpacing: '0.15em',
                        background: 'var(--color-surface-hover, rgba(0,0,0,0.04))',
                        padding: '0.25rem 0.5rem',
                        borderRadius: 'var(--radius-sm, 4px)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {visitor.pin_code || '••••••'}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopyPinOnly(visitor)}
                      title="Copy PIN code"
                      style={{
                        padding: '0.375rem 0.625rem',
                        fontSize: '0.75rem',
                        borderRadius: 'var(--radius-sm, 4px)',
                        border: '1px solid var(--color-border)',
                        background: isPinCopied ? 'rgba(34, 197, 94, 0.1)' : 'var(--color-surface)',
                        color: isPinCopied ? 'var(--color-success, #22c55e)' : 'inherit',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >
                      {isPinCopied ? '✓' : 'Copy'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyAccessInfo(visitor)}
                    title="Copy friendly message for SMS/Email"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      marginTop: '0.375rem',
                      fontSize: '0.6875rem',
                      color: isTextCopied ? 'var(--color-success, #22c55e)' : 'var(--color-accent, #2563eb)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    <ShareIcon />
                    <span>{isTextCopied ? 'Copied Invitation!' : 'Copy Invitation Message'}</span>
                  </button>
                </div>

                {/* 4. Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVisitor(visitor);
                          setModalOpen(true);
                        }}
                        title="Edit Visitor"
                        style={{
                          padding: '0.5rem',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-surface)',
                          cursor: 'pointer',
                          color: 'var(--color-text)',
                        }}
                      >
                        <EditIcon />
                      </button>

                      {visitor.status !== 'revoked' && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(visitor)}
                          title="Revoke Access"
                          style={{
                            padding: '0.5rem',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            background: 'rgba(239, 68, 68, 0.05)',
                            color: 'var(--color-danger, #ef4444)',
                            cursor: 'pointer',
                          }}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Visitor Modal */}
      {modalOpen && (
        <VisitorModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditingVisitor(null);
          }}
          orgId={orgId || ''}
          visitor={editingVisitor}
          doors={doors}
          onSaved={() => {
            showFeedback(
              editingVisitor ? 'Visitor updated successfully!' : 'Visitor created successfully!',
              true
            );
          }}
        />
      )}
    </div>
  );
}
