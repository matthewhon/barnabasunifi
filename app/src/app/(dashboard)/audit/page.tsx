'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { subscribeToAuditLog } from '@/lib/firestore';
import type { AuditLogEntry, AuditAction } from '@/lib/types';
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<AuditAction, string> = {
  unlock: 'Door Unlocked (Scheduled)',
  lock: 'Door Locked (Scheduled)',
  manual_unlock: 'Manual Unlock',
  manual_lock: 'Manual Lock',
  pco_sync: 'PCO Sync',
  agent_online: 'Agent Online',
  agent_offline: 'Agent Offline',
  schedule_created: 'Schedule Created',
  schedule_cancelled: 'Schedule Cancelled',
};

const ALL_ACTIONS: AuditAction[] = [
  'unlock', 'lock', 'manual_unlock', 'manual_lock',
  'pco_sync', 'agent_online', 'agent_offline',
  'schedule_created', 'schedule_cancelled',
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

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCsv(entries: AuditLogEntry[]) {
  const headers = ['Timestamp', 'Action', 'Door', 'Triggered By', 'Actor', 'Result', 'Message'];
  const rows = entries.map((e) => [
    e.timestamp,
    ACTION_LABELS[e.action] ?? e.action,
    e.door_label ?? '',
    e.triggered_by,
    e.actor_label ?? e.actor_uid ?? '',
    e.result,
    e.message ?? '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export default function AuditPage() {
  const { orgId } = useAuth();

  const [allEntries, setAllEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // Filters
  const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all');
  const [resultFilter, setResultFilter] = useState<'all' | 'success' | 'error'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const subscribeCount = useRef(100);

  useEffect(() => {
    if (!orgId) return;
    const unsub = subscribeToAuditLog(orgId, (entries) => {
      setAllEntries(entries);
      setLoading(false);
    }, subscribeCount.current);
    return unsub;
  }, [orgId]);

  const filtered = allEntries.filter((e) => {
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (resultFilter !== 'all' && e.result !== resultFilter) return false;
    if (dateFrom) {
      try {
        if (isBefore(parseISO(e.timestamp), startOfDay(parseISO(dateFrom)))) return false;
      } catch { /* ignore parse errors */ }
    }
    if (dateTo) {
      try {
        if (isAfter(parseISO(e.timestamp), endOfDay(parseISO(dateTo)))) return false;
      } catch { /* ignore parse errors */ }
    }
    return true;
  });

  const displayed = filtered.slice(0, displayCount);
  const hasMore = filtered.length > displayCount;

  function handleLoadMore() {
    setDisplayCount((c) => c + PAGE_SIZE);
    // If we're approaching the subscribed count, re-subscribe with more
    if (displayCount + PAGE_SIZE > subscribeCount.current * 0.8) {
      subscribeCount.current = subscribeCount.current + 100;
    }
  }

  const handleExport = useCallback(() => {
    exportCsv(filtered);
  }, [filtered]);

  function clearFilters() {
    setActionFilter('all');
    setResultFilter('all');
    setDateFrom('');
    setDateTo('');
    setDisplayCount(PAGE_SIZE);
  }

  const hasActiveFilters =
    actionFilter !== 'all' || resultFilter !== 'all' || dateFrom || dateTo;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Audit Log</h1>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleExport}
          disabled={filtered.length === 0}
        >
          <DownloadIcon />
          Export CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'flex-end',
          marginBottom: '1.5rem',
          padding: '1rem',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        {/* Action filter */}
        <div className="form-group" style={{ flex: '2 1 12rem' }}>
          <label className="form-label">Action Type</label>
          <select
            className="form-select"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as AuditAction | 'all')}
          >
            <option value="all">All Actions</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </div>

        {/* Result filter */}
        <div className="form-group" style={{ flex: '1 1 8rem' }}>
          <label className="form-label">Result</label>
          <select
            className="form-select"
            value={resultFilter}
            onChange={(e) => setResultFilter(e.target.value as 'all' | 'success' | 'error')}
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </select>
        </div>

        {/* Date range */}
        <div className="form-group" style={{ flex: '1 1 8rem' }}>
          <label className="form-label">From Date</label>
          <input
            type="date"
            className="form-input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="form-group" style={{ flex: '1 1 8rem' }}>
          <label className="form-label">To Date</label>
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
            style={{ alignSelf: 'flex-end', marginBottom: '0.0625rem' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        Showing {displayed.length} of {filtered.length} entries
        {hasActiveFilters && ' (filtered)'}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: '3.25rem', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="card empty-state">
          <p className="empty-state-title">No audit entries found</p>
          <p style={{ fontSize: '0.875rem' }}>
            {hasActiveFilters ? 'Try adjusting your filters.' : 'Activity will appear here as doors are used.'}
          </p>
          {hasActiveFilters && (
            <button className="btn btn-secondary btn-sm" onClick={clearFilters} style={{ marginTop: '0.75rem' }}>
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Door</th>
                  <th>Triggered By</th>
                  <th>Actor</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      {format(parseISO(entry.timestamp), 'MMM d, yyyy HH:mm:ss')}
                    </td>
                    <td>
                      <span style={{ fontWeight: 500, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      {entry.message && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                          {entry.message}
                        </div>
                      )}
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                      {entry.door_label ?? '—'}
                    </td>
                    <td>
                      <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
                        {entry.triggered_by}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                      {entry.actor_label ?? entry.actor_uid?.slice(0, 8) ?? '—'}
                    </td>
                    <td>
                      <span
                        className={`badge ${entry.result === 'success' ? 'badge-success' : 'badge-danger'}`}
                      >
                        {entry.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem' }}>
              <button className="btn btn-secondary" onClick={handleLoadMore}>
                Load {Math.min(PAGE_SIZE, filtered.length - displayCount)} More
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
