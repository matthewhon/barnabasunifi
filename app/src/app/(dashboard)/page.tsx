'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToDoors,
  subscribeToScheduleWindows,
  subscribeToAuditLog,
} from '@/lib/firestore';
import type { Door, ScheduleWindow, AuditLogEntry } from '@/lib/types';
import { formatDistanceToNow, format, isPast } from 'date-fns';

// ─── Icons ────────────────────────────────────────────────────────────────────

function LockIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div className="skeleton" style={{ height: '1rem', width: '60%', borderRadius: 'var(--radius-sm)' }} />
      <div className="skeleton" style={{ height: '1.5rem', width: '40%', borderRadius: 'var(--radius-sm)' }} />
      <div className="skeleton" style={{ height: '0.75rem', width: '80%', borderRadius: 'var(--radius-sm)' }} />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid var(--color-border)', alignItems: 'center' }}>
      <div className="skeleton" style={{ height: '0.875rem', flex: 2, borderRadius: 'var(--radius-sm)' }} />
      <div className="skeleton" style={{ height: '0.875rem', flex: 1, borderRadius: 'var(--radius-sm)' }} />
      <div className="skeleton" style={{ height: '0.875rem', flex: 1, borderRadius: 'var(--radius-sm)' }} />
    </div>
  );
}

// ─── Door Status Card ─────────────────────────────────────────────────────────

function DoorStatusCard({ door }: { door: Door }) {
  const isLocked = door.current_state === 'locked';
  const isUnknown = door.current_state === 'unknown';

  const borderColor = isUnknown
    ? 'var(--color-border)'
    : isLocked
    ? 'rgba(239,68,68,0.3)'
    : 'rgba(34,197,94,0.3)';

  return (
    <div
      className="card"
      style={{
        borderColor,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}>
          {door.label}
        </span>
        {isUnknown ? (
          <LockIcon color="var(--color-text-muted)" />
        ) : isLocked ? (
          <LockIcon color="var(--color-danger)" />
        ) : (
          <UnlockIcon color="var(--color-success)" />
        )}
      </div>

      <div>
        <span
          className={`badge ${
            isUnknown ? 'badge-neutral' : isLocked ? 'badge-danger' : 'badge-success'
          }`}
        >
          {isUnknown ? 'Unknown' : isLocked ? 'Locked' : 'Unlocked'}
        </span>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
        Synced{' '}
        {door.last_synced
          ? formatDistanceToNow(new Date(door.last_synced), { addSuffix: true })
          : '—'}
      </div>
    </div>
  );
}

// ─── Schedule Window Row ──────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  switch (status) {
    case 'pending': return 'badge-info';
    case 'unlocked': return 'badge-success';
    case 'locked': return 'badge-neutral';
    case 'cancelled': return 'badge-warning';
    case 'error': return 'badge-danger';
    default: return 'badge-neutral';
  }
}

function ScheduleWindowRow({ window: win }: { window: ScheduleWindow }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0.625rem 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.875rem',
      }}
    >
      <div style={{ flex: '2 1 8rem', minWidth: 0 }}>
        <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {win.source_label}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
          {win.door_labels.join(', ')}
        </div>
      </div>
      <div style={{ flex: '1 1 7rem', color: 'var(--color-text-secondary)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
        {format(new Date(win.unlock_at), 'MMM d, h:mm a')}
        <span style={{ color: 'var(--color-text-muted)', margin: '0 0.25rem' }}>→</span>
        {format(new Date(win.lock_at), 'h:mm a')}
      </div>
      <span className={`badge ${statusBadgeClass(win.status)}`} style={{ flexShrink: 0 }}>
        {win.status}
      </span>
    </div>
  );
}

// ─── Audit Row ────────────────────────────────────────────────────────────────

const auditActionLabels: Record<string, string> = {
  unlock: 'Door Unlocked',
  lock: 'Door Locked',
  manual_unlock: 'Manual Unlock',
  manual_lock: 'Manual Lock',
  pco_sync: 'PCO Sync',
  agent_online: 'Agent Online',
  agent_offline: 'Agent Offline',
  schedule_created: 'Schedule Created',
  schedule_cancelled: 'Schedule Cancelled',
};

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.8125rem',
      }}
    >
      <span
        className={`badge ${entry.result === 'success' ? 'badge-success' : 'badge-danger'}`}
        style={{ flexShrink: 0 }}
      >
        {entry.result}
      </span>
      <span style={{ flex: 1, color: 'var(--color-text-primary)', fontWeight: 500 }}>
        {auditActionLabels[entry.action] ?? entry.action}
        {entry.door_label && (
          <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>
            {' — '}{entry.door_label}
          </span>
        )}
      </span>
      <span style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
        {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
      </span>
    </div>
  );
}

// ─── Main Dashboard Page ──────────────────────────────────────────────────────

export default function DashboardPage() {
  const { orgId, profile } = useAuth();

  const [doors, setDoors] = useState<Door[]>([]);
  const [doorsLoading, setDoorsLoading] = useState(true);

  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = profile?.display_name?.split(' ')[0] ?? 'there';

  // Real-time subscriptions
  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => {
      setDoors(d);
      setDoorsLoading(false);
    });

    const unsubWindows = subscribeToScheduleWindows(orgId, (w) => {
      setScheduleWindows(w);
      setScheduleLoading(false);
    });

    const unsubAudit = subscribeToAuditLog(orgId, (a) => {
      setAuditLog(a);
      setAuditLoading(false);
    }, 10);

    return () => {
      unsubDoors();
      unsubWindows();
      unsubAudit();
    };
  }, [orgId]);

  const handleSyncNow = useCallback(async () => {
    if (!orgId) return;
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const triggerPcoSync = httpsCallable(functions, 'triggerPcoSync');
      await triggerPcoSync({ orgId });
      setSyncMessage('Sync triggered successfully.');
    } catch {
      setSyncMessage('Sync failed. Check your PCO connection in Settings.');
    } finally {
      setSyncLoading(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  }, [orgId]);

  // Upcoming: future windows, sorted asc, top 5
  const upcoming = scheduleWindows
    .filter((w) => !isPast(new Date(w.lock_at)) && w.status !== 'cancelled')
    .slice(0, 5);

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {greeting}, {firstName} 👋
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Here&apos;s what&apos;s happening with your doors today.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSyncNow}
            disabled={syncLoading}
          >
            <RefreshIcon />
            {syncLoading ? 'Syncing…' : 'Sync PCO Now'}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          className={`alert ${syncMessage.startsWith('Sync triggered') ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.5rem' }}
        >
          {syncMessage}
        </div>
      )}

      {/* Door Status Grid */}
      <section className="section">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Door Status
          </h2>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Live · {doors.length} door{doors.length !== 1 ? 's' : ''}
          </span>
        </div>

        {doorsLoading ? (
          <div className="grid grid-cols-3">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : doors.length === 0 ? (
          <div className="card empty-state">
            <p className="empty-state-title">No doors configured</p>
            <p style={{ fontSize: '0.875rem' }}>
              Set up your local UniFi agent to start seeing door status here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3">
            {doors.map((door) => (
              <DoorStatusCard key={door.id} door={door} />
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Upcoming Unlock Windows */}
        <section className="section card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Upcoming Unlock Windows
          </h2>

          {scheduleLoading ? (
            [1, 2, 3].map((i) => <SkeletonRow key={i} />)
          ) : upcoming.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <p className="empty-state-title">No upcoming windows</p>
              <p style={{ fontSize: '0.8125rem' }}>Sync PCO to pull in scheduled events.</p>
            </div>
          ) : (
            upcoming.map((win) => <ScheduleWindowRow key={win.id} window={win} />)
          )}
        </section>

        {/* Recent Activity */}
        <section className="section card" style={{ margin: 0 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-text-primary)' }}>
            Recent Activity
          </h2>

          {auditLoading ? (
            [1, 2, 3].map((i) => <SkeletonRow key={i} />)
          ) : auditLog.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 1rem' }}>
              <p className="empty-state-title">No activity yet</p>
              <p style={{ fontSize: '0.8125rem' }}>Audit events will appear here.</p>
            </div>
          ) : (
            auditLog.map((entry) => <AuditRow key={entry.id} entry={entry} />)
          )}
        </section>
      </div>

      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
