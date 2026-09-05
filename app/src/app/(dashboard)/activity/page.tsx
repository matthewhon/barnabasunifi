'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { subscribeToAccessLogs, subscribeToDoors } from '@/lib/firestore';
import type { AccessLogEntry, AccessMethod, Door } from '@/lib/types';
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { safeFormat } from '@/lib/date-utils';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

// ─── Constants & Labels ───────────────────────────────────────────────────────

const METHOD_LABELS: Record<AccessMethod, string> = {
  nfc_card: 'Key Card / Fob',
  pin_code: 'Keypad PIN',
  mobile_tap: 'Mobile Tap',
  hand_wave: 'Hand Wave',
  remote: 'Remote Unlock',
  face: 'Face Recognition',
  visitor_pin: 'Visitor PIN / QR',
  schedule: 'Schedule',
  unknown: 'Unknown Method',
};

const ALL_METHODS: AccessMethod[] = [
  'nfc_card',
  'pin_code',
  'mobile_tap',
  'hand_wave',
  'remote',
  'face',
  'visitor_pin',
  'schedule',
  'unknown',
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function RefreshIcon({ spin = false }: { spin?: boolean }) {
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
      style={{ animation: spin ? 'spin 1s linear infinite' : 'none' }}
    >
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
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

function CardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01" />
    </svg>
  );
}

function MobileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

function RemoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  );
}

function UserFaceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function DoorSensorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <circle cx="14" cy="12" r="1" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderMethodIcon(method: AccessMethod) {
  switch (method) {
    case 'nfc_card':
      return <CardIcon />;
    case 'pin_code':
    case 'visitor_pin':
      return <PinIcon />;
    case 'mobile_tap':
      return <MobileIcon />;
    case 'hand_wave':
      return <WaveIcon />;
    case 'remote':
      return <RemoteIcon />;
    case 'face':
      return <UserFaceIcon />;
    default:
      return <DoorSensorIcon />;
  }
}

function renderResultBadge(result: string, eventType: string) {
  const norm = (result || eventType || '').toLowerCase();
  if (norm.includes('success') || norm.includes('access') || norm.includes('granted') || norm.includes('unlock')) {
    return (
      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {norm.includes('unlock') ? 'Unlocked' : 'Access Granted'}
      </span>
    );
  }
  if (norm.includes('denied') || norm.includes('reject') || norm.includes('fail')) {
    return (
      <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        Access Denied
      </span>
    );
  }
  if (norm.includes('open')) {
    return (
      <span className="badge" style={{ background: 'rgba(36, 101, 245, 0.12)', color: '#2465f5', border: '1px solid rgba(36, 101, 245, 0.25)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2465f5' }} />
        Door Opened
      </span>
    );
  }
  if (norm.includes('close')) {
    return (
      <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        Door Closed
      </span>
    );
  }
  return <span className="badge badge-secondary">{result || eventType}</span>;
}

function exportCsv(entries: AccessLogEntry[]) {
  const headers = ['Timestamp', 'Door', 'User / Actor', 'User Type', 'Access Method', 'Event', 'Result', 'Message'];
  const rows = entries.map((e) => [
    e.timestamp,
    e.door_label ?? '',
    e.user_name ?? '',
    e.user_type ?? 'unknown',
    e.access_method_label ?? e.access_method,
    e.event_type,
    e.event_result,
    e.display_message ?? '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `access-activity-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

const PAGE_SIZE = 30;

export default function AccessActivityPage() {
  const { orgId } = useAuth();

  const [allEntries, setAllEntries] = useState<AccessLogEntry[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDoor, setSelectedDoor] = useState<string>('all');
  const [methodFilter, setMethodFilter] = useState<AccessMethod | 'all'>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const subscribeLimit = useRef(250);

  const showFeedback = useCallback((text: string, ok: boolean) => {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4000);
  }, []);

  // Subscriptions
  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));
    const unsubLogs = subscribeToAccessLogs(
      orgId,
      (entries) => {
        setAllEntries(entries);
        setLoading(false);
      },
      subscribeLimit.current
    );

    return () => {
      unsubDoors();
      unsubLogs();
    };
  }, [orgId]);

  // Sync Trigger
  const handleSyncNow = async (backfillInput?: boolean | React.MouseEvent) => {
    if (!orgId || syncing) return;
    const backfill = typeof backfillInput === 'boolean' ? backfillInput : false;
    setSyncing(true);
    try {
      const fn = httpsCallable(functions, 'syncUnifiAccessLogs');
      const res: any = await fn({ orgId, backfill, days: backfill ? 90 : 30 });
      const mode = res.data?.mode;
      const count = res.data?.count;
      if (mode === 'remote') {
        showFeedback(`Synced ${count ?? 0} activity log(s) from UniFi Access into permanent Firebase archive.`, true);
      } else {
        showFeedback(
          backfill
            ? 'Full 90-day archive command dispatched to agent. Pulling all available UniFi history into Firebase…'
            : 'Sync command dispatched to local agent.',
          true
        );
      }
    } catch (err: any) {
      showFeedback(err.message || 'Failed to sync activity logs.', false);
    } finally {
      setSyncing(false);
    }
  };

  // KPI Calculations
  const kpis = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let todayEvents = 0;
    const uniqueUsersToday = new Set<string>();
    const doorCounts: Record<string, number> = {};
    const methodCounts: Record<string, number> = {};

    for (const entry of allEntries) {
      if (entry.timestamp && entry.timestamp.startsWith(todayStr)) {
        todayEvents++;
        if (entry.user_name && entry.user_name !== 'Anonymous / Guest' && entry.user_name !== 'Unknown User') {
          uniqueUsersToday.add(entry.user_name);
        }
      }
      if (entry.door_label) {
        doorCounts[entry.door_label] = (doorCounts[entry.door_label] || 0) + 1;
      }
      if (entry.access_method_label) {
        methodCounts[entry.access_method_label] = (methodCounts[entry.access_method_label] || 0) + 1;
      }
    }

    const topDoor = Object.entries(doorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
    const topMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NFC / PIN';

    return {
      total: allEntries.length,
      todayEvents,
      uniqueUsersToday: uniqueUsersToday.size,
      topDoor,
      topMethod,
    };
  }, [allEntries]);

  // Filtered Entries
  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesUser = e.user_name?.toLowerCase().includes(q);
        const matchesDoor = e.door_label?.toLowerCase().includes(q);
        const matchesMethod = e.access_method_label?.toLowerCase().includes(q);
        const matchesMsg = e.display_message?.toLowerCase().includes(q);
        if (!matchesUser && !matchesDoor && !matchesMethod && !matchesMsg) return false;
      }

      // Door Filter
      if (selectedDoor !== 'all') {
        if (e.door_id !== selectedDoor && e.door_label !== selectedDoor) return false;
      }

      // Method Filter
      if (methodFilter !== 'all' && e.access_method !== methodFilter) {
        return false;
      }

      // Event Type Filter
      if (eventTypeFilter !== 'all') {
        if (eventTypeFilter === 'opened' && !e.event_type.includes('open')) return false;
        if (eventTypeFilter === 'closed' && !e.event_type.includes('close')) return false;
        if (eventTypeFilter === 'granted' && e.event_result !== 'success') return false;
        if (eventTypeFilter === 'denied' && e.event_result !== 'denied') return false;
      }

      // Date Range
      if (dateFrom) {
        try {
          if (isBefore(parseISO(e.timestamp), startOfDay(parseISO(dateFrom)))) return false;
        } catch { /* ignore */ }
      }
      if (dateTo) {
        try {
          if (isAfter(parseISO(e.timestamp), endOfDay(parseISO(dateTo)))) return false;
        } catch { /* ignore */ }
      }

      return true;
    });
  }, [allEntries, searchQuery, selectedDoor, methodFilter, eventTypeFilter, dateFrom, dateTo]);

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;

  function handleLoadMore() {
    setDisplayCount((c) => c + PAGE_SIZE);
    if (displayCount + PAGE_SIZE > subscribeLimit.current * 0.8) {
      subscribeLimit.current = subscribeLimit.current + 200;
    }
  }

  function clearFilters() {
    setSearchQuery('');
    setSelectedDoor('all');
    setMethodFilter('all');
    setEventTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setDisplayCount(PAGE_SIZE);
  }

  const hasActiveFilters =
    Boolean(searchQuery) ||
    selectedDoor !== 'all' ||
    methodFilter !== 'all' ||
    eventTypeFilter !== 'all' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Toast Feedback */}
      {feedback && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            zIndex: 100,
            padding: '0.75rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: feedback.ok ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)',
            color: '#fff',
            fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            backdropFilter: 'blur(4px)',
            transition: 'all var(--transition-fast)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Activity & Access Logs</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                padding: '0.2rem 0.5rem',
                borderRadius: '9999px',
                letterSpacing: '0.02em',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 6px #10b981',
                  animation: 'pulse 2s infinite',
                }}
              />
              LIVE FEED
            </span>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Real-time door access events, credential methods, and physical door opens/closes by user.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleSyncNow(false)}
            disabled={syncing}
            title="Poll UniFi Access API for fresh logs"
          >
            <RefreshIcon spin={syncing} />
            {syncing ? 'Syncing…' : 'Sync Recent'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleSyncNow(true)}
            disabled={syncing}
            title="Deep pull: Fetch up to 90 days of all available historical activity logs from UniFi Access into permanent Firebase storage"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <span>📦</span>
            <span>Archive History (90d)</span>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
          >
            <DownloadIcon />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Events Today
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.25rem' }}>
            {kpis.todayEvents}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {kpis.total} total recorded
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Unique Users Today
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2465f5', marginTop: '0.25rem' }}>
            {kpis.uniqueUsersToday}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Active credentials today
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Top Access Method
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {kpis.topMethod}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Primary credential type
          </div>
        </div>

        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Most Active Door
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {kpis.topDoor}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Highest traffic entrance
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '1rem',
          marginBottom: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          {/* Search Box */}
          <div className="form-group" style={{ flex: '3 1 14rem' }}>
            <label className="form-label">Search User or Door</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Filter by name, door, or message..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '2.25rem' }}
              />
              <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
                <SearchIcon />
              </span>
            </div>
          </div>

          {/* Door Filter */}
          <div className="form-group" style={{ flex: '2 1 11rem' }}>
            <label className="form-label">Door</label>
            <select
              className="form-select"
              value={selectedDoor}
              onChange={(e) => setSelectedDoor(e.target.value)}
            >
              <option value="all">All Doors</option>
              {doors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || d.id}
                </option>
              ))}
            </select>
          </div>

          {/* Method Filter */}
          <div className="form-group" style={{ flex: '2 1 11rem' }}>
            <label className="form-label">Access Method</label>
            <select
              className="form-select"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as AccessMethod | 'all')}
            >
              <option value="all">All Methods</option>
              {ALL_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {/* Event Type Filter */}
          <div className="form-group" style={{ flex: '1.5 1 9rem' }}>
            <label className="form-label">Event Result</label>
            <select
              className="form-select"
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
            >
              <option value="all">All Results</option>
              <option value="granted">Access Granted</option>
              <option value="denied">Access Denied</option>
              <option value="opened">Door Opened</option>
              <option value="closed">Door Closed</option>
            </select>
          </div>
        </div>

        {/* Date Filters & Clear */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', paddingTop: '0.25rem' }}>
          <div className="form-group" style={{ flex: '1 1 9rem' }}>
            <label className="form-label">From</label>
            <input
              type="date"
              className="form-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ flex: '1 1 9rem' }}>
            <label className="form-label">To</label>
            <input
              type="date"
              className="form-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearFilters}
              style={{ alignSelf: 'flex-end', height: '2.375rem', marginBottom: '0.25rem' }}
            >
              Clear Filters
            </button>
          )}

          <div style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--color-text-muted)', alignSelf: 'center' }}>
            Showing {displayed.length} of {filtered.length} entries
          </div>
        </div>
      </div>

      {/* Access Activity Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div
              style={{
                width: '2rem',
                height: '2rem',
                border: '3px solid var(--color-border)',
                borderTopColor: 'var(--color-accent)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            Loading activity stream…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚪</div>
            <h3 style={{ margin: '0 0 0.5rem', color: 'var(--color-text-primary)' }}>
              {hasActiveFilters ? 'No matching activity' : 'No door activity recorded yet'}
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
              {hasActiveFilters
                ? 'Try adjusting your search criteria or date filters.'
                : 'As users tap cards, enter PINs, use mobile keys, or sensors trigger, their events will stream here live.'}
            </p>
            {hasActiveFilters ? (
              <button className="btn btn-secondary btn-sm" onClick={clearFilters}>
                Clear All Filters
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSyncNow} disabled={syncing}>
                <RefreshIcon spin={syncing} />
                Sync Recent Logs from UniFi
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>Timestamp</th>
                  <th>User / Actor</th>
                  <th>Door</th>
                  <th>Access Method</th>
                  <th>Event / Result</th>
                  <th>Activity Details</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((entry) => (
                  <tr key={entry.id}>
                    {/* Timestamp */}
                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {safeFormat(entry.timestamp, 'h:mm:ss a')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {safeFormat(entry.timestamp, 'MMM d, yyyy')}
                      </div>
                    </td>

                    {/* User / Actor */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div
                          style={{
                            width: '1.75rem',
                            height: '1.75rem',
                            borderRadius: '50%',
                            background: entry.user_type === 'visitor' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(36, 101, 245, 0.15)',
                            color: entry.user_type === 'visitor' ? '#d97706' : '#2465f5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {(entry.user_name || 'U')[0].toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                            {entry.user_name || 'Anonymous / Sensor'}
                          </div>
                          {entry.user_type && entry.user_type !== 'unknown' && (
                            <span
                              style={{
                                fontSize: '0.6875rem',
                                color: entry.user_type === 'visitor' ? '#d97706' : 'var(--color-text-muted)',
                                textTransform: 'capitalize',
                              }}
                            >
                              {entry.user_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Door */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        <DoorSensorIcon />
                        {entry.door_label || 'Unspecified Door'}
                      </div>
                    </td>

                    {/* Access Method */}
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.375rem',
                          padding: '0.25rem 0.625rem',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8125rem',
                          background: 'var(--color-bg-base)',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-text-primary)',
                          fontWeight: 500,
                        }}
                      >
                        {renderMethodIcon(entry.access_method)}
                        {entry.access_method_label || METHOD_LABELS[entry.access_method] || 'Unknown'}
                      </span>
                    </td>

                    {/* Event & Result */}
                    <td>
                      {renderResultBadge(entry.event_result, entry.event_type)}
                    </td>

                    {/* Activity Details / Message */}
                    <td style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', maxWidth: '280px' }}>
                      {entry.display_message || `${entry.event_type} (${entry.event_result})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Load More Footer */}
        {hasMore && (
          <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleLoadMore}>
              Load More Activity
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );
}
