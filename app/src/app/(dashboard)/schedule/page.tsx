'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToScheduleWindows,
  subscribeToUnifiSchedules,
  subscribeToDoors,
} from '@/lib/firestore';
import type {
  ScheduleWindow,
  MappingSourceType,
  UnifiSchedule,
  Door,
  DayOfWeek,
} from '@/lib/types';
import { format } from 'date-fns';
import { safeIsPast } from '@/lib/date-utils';
import { toZonedTime } from 'date-fns-tz';
import UnifiScheduleModal from '@/components/schedules/UnifiScheduleModal';

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

function formatTime12h(time24: string): string {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr || '00'} ${ampm}`;
}

function formatScheduleSummary(schedule: UnifiSchedule): string {
  const weekly = schedule.weekly_schedule;
  if (!weekly || weekly.length === 0) return 'No hours configured';
  const activeDays = weekly.filter((d) => d.active && d.slots.length > 0);
  if (activeDays.length === 0) return 'Always locked (no active days)';

  // Check All 7 Days
  if (activeDays.length === 7) {
    const firstSlot = activeDays[0].slots[0];
    const allSame = activeDays.every(
      (d) => d.slots[0]?.start_time === firstSlot?.start_time && d.slots[0]?.end_time === firstSlot?.end_time
    );
    if (allSame && firstSlot) {
      return `Daily: ${formatTime12h(firstSlot.start_time)} – ${formatTime12h(firstSlot.end_time)}`;
    }
  }

  // Check Mon-Fri
  const weekdays = activeDays.filter((d) => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d.day));
  if (weekdays.length === 5) {
    const firstSlot = weekdays[0].slots[0];
    const allSame = weekdays.every(
      (d) => d.slots[0]?.start_time === firstSlot?.start_time && d.slots[0]?.end_time === firstSlot?.end_time
    );
    if (allSame && firstSlot) {
      const weekend = activeDays.filter((d) => ['saturday', 'sunday'].includes(d.day));
      if (weekend.length === 0) {
        return `Mon–Fri: ${formatTime12h(firstSlot.start_time)} – ${formatTime12h(firstSlot.end_time)}`;
      }
    }
  }

  return activeDays
    .map((d) => {
      const dayName = d.day.slice(0, 3);
      const slot = d.slots[0];
      return slot ? `${dayName.toUpperCase()}: ${formatTime12h(slot.start_time)}-${formatTime12h(slot.end_time)}` : dayName;
    })
    .join(' · ');
}

const WEEK_DAYS: { key: DayOfWeek; letter: string }[] = [
  { key: 'monday', letter: 'M' },
  { key: 'tuesday', letter: 'T' },
  { key: 'wednesday', letter: 'W' },
  { key: 'thursday', letter: 'T' },
  { key: 'friday', letter: 'F' },
  { key: 'saturday', letter: 'S' },
  { key: 'sunday', letter: 'S' },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = 'unifi' | 'pco';
type TabKey = 'upcoming' | 'past' | 'all';
type SourceFilter = 'all' | MappingSourceType;

export default function SchedulePage() {
  const { orgId, role, isSuperAdmin } = useAuth();
  const isOrgAdmin = role === 'org_admin' || isSuperAdmin;

  const [viewMode, setViewMode] = useState<ViewMode>('unifi');
  const [unifiSubTab, setUnifiSubTab] = useState<'doors' | 'schedules'>('doors');

  // UniFi Schedules State
  const [unifiSchedules, setUnifiSchedules] = useState<UnifiSchedule[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [unifiLoading, setUnifiLoading] = useState(true);
  const [unifiSyncing, setUnifiSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<UnifiSchedule | null>(null);

  // Planning Center State
  const [allWindows, setAllWindows] = useState<ScheduleWindow[]>([]);
  const [pcoLoading, setPcoLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [pcoSyncLoading, setPcoSyncLoading] = useState(false);

  // Common notifications
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const timezone = 'America/Chicago';

  // Subscriptions
  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));

    const unsubUnifi = subscribeToUnifiSchedules(orgId, (scheds) => {
      setUnifiSchedules(scheds);
      setUnifiLoading(false);
    });

    const unsubPco = subscribeToScheduleWindows(orgId, (w) => {
      setAllWindows(w);
      setPcoLoading(false);
    });

    return () => {
      unsubDoors();
      unsubUnifi();
      unsubPco();
    };
  }, [orgId]);

  // Sync UniFi Schedules
  const handleSyncUnifi = useCallback(async () => {
    if (!orgId) return;
    setUnifiSyncing(true);
    setFeedbackMessage(null);
    try {
      const fn = httpsCallable(functions, 'syncUnifiSchedules');
      const res = (await fn({ orgId })) as { data: { success: boolean; mode: string; count?: number } };
      if (res.data?.mode === 'remote') {
        setFeedbackMessage({
          text: `Successfully synced ${res.data.count ?? 0} schedule(s) from UniFi Access.`,
          ok: true,
        });
      } else {
        setFeedbackMessage({
          text: 'Schedule sync command queued for local agent.',
          ok: true,
        });
      }
    } catch (err: any) {
      setFeedbackMessage({
        text: err.message || 'Failed to sync schedules from UniFi Access.',
        ok: false,
      });
    } finally {
      setUnifiSyncing(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  }, [orgId]);

  // Sync Planning Center
  const handleSyncPco = useCallback(async () => {
    if (!orgId) return;
    setPcoSyncLoading(true);
    setFeedbackMessage(null);
    try {
      const fn = httpsCallable(functions, 'triggerPcoSync');
      await fn({ orgId });
      setFeedbackMessage({ text: 'Planning Center sync triggered successfully.', ok: true });
    } catch {
      setFeedbackMessage({ text: 'Sync failed. Check PCO connection in Settings.', ok: false });
    } finally {
      setPcoSyncLoading(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  }, [orgId]);

  // PCO Windows Filter
  const tabFiltered = allWindows.filter((w) => {
    if (tab === 'upcoming') return !safeIsPast(w.lock_at) && w.status !== 'cancelled';
    if (tab === 'past') return safeIsPast(w.lock_at) || w.status === 'cancelled';
    return true;
  });

  const displayedWindows = tabFiltered.filter((w) =>
    sourceFilter === 'all' ? true : w.source_type === sourceFilter,
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Schedules</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Manage native UniFi Access door schedules and Planning Center event windows.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {viewMode === 'unifi' ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSyncUnifi}
                disabled={unifiSyncing}
              >
                <RefreshIcon />
                {unifiSyncing ? 'Syncing from UniFi…' : 'Sync from UniFi'}
              </button>
              {isOrgAdmin && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setEditingSchedule(null);
                    setModalOpen(true);
                  }}
                >
                  <PlusIcon />
                  Create Schedule
                </button>
              )}
            </>
          ) : (
            <>
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
                onClick={handleSyncPco}
                disabled={pcoSyncLoading}
              >
                <RefreshIcon />
                {pcoSyncLoading ? 'Syncing…' : 'Sync Now'}
              </button>
            </>
          )}
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`alert ${feedbackMessage.ok ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.5rem' }}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Primary View Toggle: UniFi Schedules vs PCO Windows */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab ${viewMode === 'unifi' ? 'active' : ''}`}
          onClick={() => setViewMode('unifi')}
        >
          UniFi Access Schedules ({unifiSchedules.length})
        </button>
        <button
          className={`tab ${viewMode === 'pco' ? 'active' : ''}`}
          onClick={() => setViewMode('pco')}
        >
          Planning Center Windows ({allWindows.length})
        </button>
      </div>

      {/* ─── UNIFI SCHEDULES VIEW ─────────────────────────────────────────── */}
      {viewMode === 'unifi' && (
        <div>
          {/* Sub-view switcher: By Door vs All Schedules */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.375rem', background: 'var(--color-bg-surface)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <button
                className={`btn btn-sm ${unifiSubTab === 'doors' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
                onClick={() => setUnifiSubTab('doors')}
              >
                🚪 By Door ({doors.length})
              </button>
              <button
                className={`btn btn-sm ${unifiSubTab === 'schedules' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
                onClick={() => setUnifiSubTab('schedules')}
              >
                🗓️ All Schedules ({unifiSchedules.length})
              </button>
            </div>

            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              {unifiSubTab === 'doors'
                ? 'Showing configured unlock schedule for each physical door'
                : 'Showing global unlock rules and access policy schedules'}
            </div>
          </div>

          {unifiLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', gap: '1rem' }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" style={{ height: '11rem', borderRadius: 'var(--radius-lg)' }} />
              ))}
            </div>
          ) : unifiSubTab === 'doors' ? (
            /* ─── BY DOOR VIEW ─── */
            doors.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                <p style={{ color: 'var(--color-text-muted)' }}>No doors registered yet. Connect your agent to scan for doors.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))', gap: '1.25rem' }}>
                {doors.map((door) => {
                  const doorSched = unifiSchedules.find(
                    (s) =>
                      s.id === door.schedule_id ||
                      (door.schedule_name && s.name.toLowerCase() === door.schedule_name.toLowerCase()) ||
                      s.door_ids?.includes(door.id)
                  );

                  return (
                    <div
                      key={door.id}
                      className="card"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        borderLeft: doorSched ? '4px solid var(--color-accent)' : '4px solid var(--color-border)',
                      }}
                    >
                      <div>
                        {/* Door Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ fontSize: '1.125rem' }}>🚪</span>
                              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                {door.label || door.id}
                              </h3>
                            </div>
                            <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
                              <span className={`badge ${door.current_state === 'unlocked' ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '0.6875rem' }}>
                                {door.current_state === 'unlocked' ? '🔓 Unlocked' : '🔒 Locked'}
                              </span>
                              {door.door_position_status && (
                                <span className={`badge ${door.door_position_status === 'open' ? 'badge-warning' : 'badge-neutral'}`} style={{ fontSize: '0.6875rem' }}>
                                  {door.door_position_status === 'open' ? 'Open' : 'Closed'}
                                </span>
                              )}
                            </div>
                          </div>

                          {isOrgAdmin && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', gap: '0.25rem' }}
                              onClick={() => {
                                if (doorSched) {
                                  setEditingSchedule(doorSched);
                                } else {
                                  setEditingSchedule({
                                    id: `door-sched-${door.id}`,
                                    org_id: orgId || '',
                                    unifi_schedule_id: '',
                                    name: `${door.label || door.id} Unlock Schedule`,
                                    type: 'unlock',
                                    weekly_schedule: [],
                                    door_ids: [door.id],
                                    door_labels: [door.label || door.id],
                                  });
                                }
                                setModalOpen(true);
                              }}
                            >
                              <EditIcon />
                              {doorSched ? 'Edit' : 'Set Hours'}
                            </button>
                          )}
                        </div>

                        {/* Schedule details */}
                        {doorSched ? (
                          <>
                            <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-accent)', marginTop: '0.75rem' }}>
                              🗓️ {doorSched.name}
                            </div>

                            {/* Active Days Chips */}
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                              {WEEK_DAYS.map(({ key, letter }) => {
                                const dayConfig = doorSched.weekly_schedule?.find((d) => d.day === key);
                                const active = dayConfig?.active && (dayConfig?.slots?.length ?? 0) > 0;
                                return (
                                  <div
                                    key={key}
                                    style={{
                                      width: '1.75rem',
                                      height: '1.75rem',
                                      borderRadius: 'var(--radius-sm)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '0.75rem',
                                      fontWeight: 700,
                                      background: active ? 'rgba(36, 101, 245, 0.15)' : 'var(--color-bg-base)',
                                      color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                      border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                    }}
                                    title={`${key.toUpperCase()}: ${active ? 'Active' : 'Closed'}`}
                                  >
                                    {letter}
                                  </div>
                                );
                              })}
                            </div>

                            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, margin: '0.25rem 0 0' }}>
                              {formatScheduleSummary(doorSched)}
                            </p>
                          </>
                        ) : (
                          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)' }}>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                              No unlock schedule active
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                              Door remains locked 24/7 (opens only via card, PIN, mobile tap, or PCO window).
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div style={{ paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        <span>ID: {door.id.slice(0, 8)}…</span>
                        {doorSched?.last_synced && (
                          <span>Synced {format(new Date(doorSched.last_synced), 'MMM d, h:mm a')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : unifiSchedules.length === 0 ? (
            /* ─── EMPTY STATE ─── */
            <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
                No UniFi Access Schedules Found
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '28rem', margin: '0 auto 1.5rem' }}>
                Pull your existing unlock and access schedules directly from your UniFi Access console to view and modify them.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSyncUnifi}
                  disabled={unifiSyncing}
                >
                  <RefreshIcon />
                  {unifiSyncing ? 'Pulling from UniFi…' : 'Pull Schedules from UniFi'}
                </button>
                {isOrgAdmin && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEditingSchedule(null);
                      setModalOpen(true);
                    }}
                  >
                    <PlusIcon />
                    Create New Schedule
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* ─── ALL SCHEDULES GRID ─── */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))', gap: '1.25rem' }}>
              {unifiSchedules.map((sched) => {
                const isUnlock = sched.type === 'unlock';
                const isPending = sched.sync_status === 'pending';
                const assignedCount = sched.door_ids?.length ?? 0;

                return (
                  <div
                    key={sched.id}
                    className="card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      borderLeft: isUnlock ? '4px solid var(--color-accent)' : '4px solid #8b5cf6',
                    }}
                  >
                    <div>
                      {/* Top row: Name & Badges */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div>
                          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {sched.name}
                          </h3>
                          <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
                            <span className={`badge ${isUnlock ? 'badge-info' : 'badge-neutral'}`} style={{ fontSize: '0.6875rem' }}>
                              {isUnlock ? 'Unlock Schedule' : 'Access Policy'}
                            </span>
                            {sched.is_default && (
                              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>Default</span>
                            )}
                            {isPending && (
                              <span className="badge badge-warning" style={{ fontSize: '0.6875rem' }}>Pending Sync</span>
                            )}
                          </div>
                        </div>

                        {isOrgAdmin && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', gap: '0.25rem' }}
                            onClick={() => {
                              setEditingSchedule(sched);
                              setModalOpen(true);
                            }}
                          >
                            <EditIcon />
                            Edit
                          </button>
                        )}
                      </div>

                      {/* Active Days indicator chips */}
                      <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.75rem', marginBottom: '0.75rem' }}>
                        {WEEK_DAYS.map(({ key, letter }) => {
                          const dayConfig = sched.weekly_schedule?.find((d) => d.day === key);
                          const active = dayConfig?.active && (dayConfig?.slots?.length ?? 0) > 0;
                          return (
                            <div
                              key={key}
                              style={{
                                width: '1.75rem',
                                height: '1.75rem',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.75rem',
                                fontWeight: 700,
                                background: active ? 'rgba(36, 101, 245, 0.15)' : 'var(--color-bg-base)',
                                color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                              }}
                              title={`${key.toUpperCase()}: ${active ? 'Active' : 'Closed'}`}
                            >
                              {letter}
                            </div>
                          );
                        })}
                      </div>

                      {/* Summary text */}
                      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, margin: '0 0 0.5rem' }}>
                        {formatScheduleSummary(sched)}
                      </p>

                      {/* Assigned Door Tags */}
                      {sched.door_labels && sched.door_labels.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                          {sched.door_labels.map((dl, idx) => (
                            <span key={idx} className="badge badge-neutral" style={{ fontSize: '0.6875rem', gap: '0.25rem' }}>
                              🚪 {dl}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Footer row: Doors and Sync time */}
                    <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      <span>
                        {assignedCount > 0
                          ? `${assignedCount} door(s) assigned`
                          : 'No doors assigned'}
                      </span>
                      <span>
                        {sched.last_synced ? `Synced ${format(new Date(sched.last_synced), 'MMM d, h:mm a')}` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── PLANNING CENTER WINDOWS VIEW ─────────────────────────────────── */}
      {viewMode === 'pco' && (
        <div>
          {/* Sub-tabs for PCO windows */}
          <div className="tabs" style={{ marginBottom: '1rem' }}>
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
          {pcoLoading ? (
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
                {displayedWindows.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state" style={{ padding: '3rem 1rem' }}>
                          <p className="empty-state-title">
                            No {tab} windows{sourceFilter !== 'all' ? ` for ${sourceFilter}` : ''}
                          </p>
                          <p style={{ fontSize: '0.875rem' }}>
                            Sync with Planning Center to populate schedule windows.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <tbody>
                    {displayedWindows.map((win) => (
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
                            {win.door_labels && win.door_labels.length > 0
                              ? win.door_labels.join(', ')
                              : <span className="badge badge-neutral" style={{ opacity: 0.75 }}>Unmapped</span>}
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
      )}

      {/* Schedule Edit/Create Modal */}
      {modalOpen && (
        <UnifiScheduleModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          orgId={orgId || ''}
          schedule={editingSchedule}
          doors={doors}
          onSaved={() => {
            setFeedbackMessage({
              text: editingSchedule ? 'Schedule changes saved!' : 'New schedule created!',
              ok: true,
            });
            setTimeout(() => setFeedbackMessage(null), 4000);
          }}
        />
      )}
    </div>
  );
}
