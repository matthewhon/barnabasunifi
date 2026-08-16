'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import { subscribeToScheduleWindows } from '@/lib/firestore';
import type { ScheduleWindow, MappingSourceType } from '@/lib/types';
import { format, isPast } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending': return 'badge-info';
    case 'unlocked': return 'badge-success';
    case 'locked': return 'badge-neutral';
    case 'cancelled': return 'badge-warning';
    case 'error': return 'badge-danger';
    default: return 'badge-neutral';
  }
}

function sourceTypeBadgeClass(type: MappingSourceType): string {
  return type === 'service' ? 'badge-info' : 'badge-neutral';
}

function formatWindowTime(iso: string, tz: string): string {
  try {
    const zoned = toZonedTime(new Date(iso), tz);
    return format(zoned, 'MMM d, yyyy · h:mm a');
  } catch {
    return format(new Date(iso), 'MMM d, yyyy · h:mm a');
  }
}

function formatWindowTimeShort(iso: string, tz: string): string {
  try {
    const zoned = toZonedTime(new Date(iso), tz);
    return format(zoned, 'h:mm a');
  } catch {
    return format(new Date(iso), 'h:mm a');
  }
}

// ─── Sync Icon ────────────────────────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <tbody>
      <tr>
        <td colSpan={6}>
          <div className="empty-state" style={{ padding: '3rem 1rem' }}>
            <p className="empty-state-title">{label}</p>
            <p style={{ fontSize: '0.875rem' }}>
              Sync with Planning Center to populate schedule windows.
            </p>
          </div>
        </td>
      </tr>
    </tbody>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = 'upcoming' | 'past' | 'all';
type SourceFilter = 'all' | MappingSourceType;

export default function SchedulePage() {
  const { orgId } = useAuth();

  const [allWindows, setAllWindows] = useState<ScheduleWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Hard-code a default timezone; in production, load from org settings
  const timezone = 'America/Chicago';

  useEffect(() => {
    if (!orgId) return;
    const unsub = subscribeToScheduleWindows(orgId, (w) => {
      setAllWindows(w);
      setLoading(false);
    });
    return unsub;
  }, [orgId]);

  const handleSyncNow = useCallback(async () => {
    if (!orgId) return;
    setSyncLoading(true);
    setSyncMessage(null);
    try {
      const fn = httpsCallable(functions, 'triggerPcoSync');
      await fn({ orgId });
      setSyncMessage({ text: 'Sync triggered successfully.', ok: true });
    } catch {
      setSyncMessage({ text: 'Sync failed. Check PCO connection in Settings.', ok: false });
    } finally {
      setSyncLoading(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  }, [orgId]);

  // Filter by tab
  const tabFiltered = allWindows.filter((w) => {
    if (tab === 'upcoming') return !isPast(new Date(w.lock_at)) && w.status !== 'cancelled';
    if (tab === 'past') return isPast(new Date(w.lock_at)) || w.status === 'cancelled';
    return true;
  });

  // Filter by source type
  const displayed = tabFiltered.filter((w) =>
    sourceFilter === 'all' ? true : w.source_type === sourceFilter,
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Schedule</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Source filter */}
          <select
            className="form-select"
            style={{ width: 'auto', padding: '0.4375rem 2.25rem 0.4375rem 0.75rem' }}
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
          >
            <option value="all">All Sources</option>
            <option value="service">Services</option>
            <option value="group">Groups</option>
          </select>

          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSyncNow}
            disabled={syncLoading}
          >
            <RefreshIcon />
            {syncLoading ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          className={`alert ${syncMessage.ok ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.5rem' }}
        >
          {syncMessage.text}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {(['upcoming', 'past', 'all'] as TabKey[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton" style={{ height: '3rem', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Label</th>
                <th>Unlock At</th>
                <th>Lock At</th>
                <th>Doors</th>
                <th>Status</th>
              </tr>
            </thead>
            {displayed.length === 0 ? (
              <EmptyState label={`No ${tab} windows${sourceFilter !== 'all' ? ` for ${sourceFilter}` : ''}`} />
            ) : (
              <tbody>
                {displayed.map((win) => (
                  <tr key={win.id}>
                    <td>
                      <span className={`badge ${sourceTypeBadgeClass(win.source_type)}`}>
                        {win.source_type === 'service' ? 'Service' : 'Group'}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                        {win.source_label}
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                      {formatWindowTime(win.unlock_at, timezone)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}>
                      {formatWindowTimeShort(win.lock_at, timezone)}
                    </td>
                    <td>
                      <div
                        style={{
                          fontSize: '0.8125rem',
                          color: 'var(--color-text-secondary)',
                          maxWidth: '12rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={win.door_labels.join(', ')}
                      >
                        {win.door_labels.length > 0
                          ? win.door_labels.join(', ')
                          : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${statusBadgeClass(win.status)}`}>
                        {win.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
