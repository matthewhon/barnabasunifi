'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToScheduleWindows,
  subscribeToUnifiSchedules,
  subscribeToDoors,
  subscribeToAccessPolicies,
  subscribeToAccessPolicyMappings,
} from '@/lib/firestore';
import type {
  ScheduleWindow,
  MappingSourceType,
  UnifiSchedule,
  UnifiAccessPolicy,
  AccessPolicyMapping,
  Door,
  DayOfWeek,
} from '@/lib/types';
import { format } from 'date-fns';
import { safeIsPast } from '@/lib/date-utils';
import { toZonedTime } from 'date-fns-tz';
import Modal from '@/components/ui/Modal';
import UnifiScheduleModal from '@/components/schedules/UnifiScheduleModal';
import AccessPolicyModal from '@/components/policies/AccessPolicyModal';

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
  const activeDays = weekly.filter((d) => d.active && d.slots && d.slots.length > 0);
  if (activeDays.length === 0) return 'Always locked (no active days)';

  const formatDaySlots = (slots: { start_time: string; end_time: string }[]) =>
    slots.map((s) => `${formatTime12h(s.start_time)}–${formatTime12h(s.end_time)}`).join(', ');

  const serializeSlotsKey = (slots: { start_time: string; end_time: string }[]) =>
    slots.map((s) => `${s.start_time}-${s.end_time}`).join('|');

  // Check All 7 Days
  if (activeDays.length === 7) {
    const firstKey = serializeSlotsKey(activeDays[0].slots);
    const allSame = activeDays.every((d) => serializeSlotsKey(d.slots) === firstKey);
    if (allSame) {
      return `Daily: ${formatDaySlots(activeDays[0].slots)}`;
    }
  }

  // Check Mon-Fri
  const weekdays = activeDays.filter((d) =>
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d.day)
  );
  if (weekdays.length === 5) {
    const firstKey = serializeSlotsKey(weekdays[0].slots);
    const allSame = weekdays.every((d) => serializeSlotsKey(d.slots) === firstKey);
    if (allSame) {
      const weekend = activeDays.filter((d) => ['saturday', 'sunday'].includes(d.day));
      if (weekend.length === 0) {
        return `Mon–Fri: ${formatDaySlots(weekdays[0].slots)}`;
      }
    }
  }

  return activeDays
    .map((d) => {
      const dayName = d.day.slice(0, 3).toUpperCase();
      return `${dayName}: ${formatDaySlots(d.slots)}`;
    })
    .join(' · ');
}

function formatDayTooltip(dayConfig?: { day: DayOfWeek; active: boolean; slots: { start_time: string; end_time: string }[] }): string {
  if (!dayConfig || !dayConfig.active || !dayConfig.slots || dayConfig.slots.length === 0) {
    return `${dayConfig?.day?.toUpperCase() || 'DAY'}: Closed / Locked`;
  }
  const slotsStr = dayConfig.slots
    .map((s, idx) => `Window #${idx + 1}: ${formatTime12h(s.start_time)} – ${formatTime12h(s.end_time)}`)
    .join('\n');
  return `${dayConfig.day.toUpperCase()} (${dayConfig.slots.length} ${dayConfig.slots.length === 1 ? 'window' : 'windows'}):\n${slotsStr}`;
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

function getFriendlyScheduleName(name?: string | null, fallbackLabel?: string): string {
  if (!name || !name.trim()) return fallbackLabel ? `${fallbackLabel} Unlock Schedule` : 'Unlock Schedule';
  const trimmed = name.trim();
  if (isUuid(trimmed) || trimmed.toLowerCase() === 'schedule' || trimmed.startsWith('unlock-')) {
    return fallbackLabel ? `${fallbackLabel} Unlock Schedule` : 'Unlock Schedule';
  }
  return trimmed;
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

function RefreshIcon({ spinning = false }: { spinning?: boolean } = {}) {
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
      style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}
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
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = 'policies' | 'unifi' | 'pco';
type TabKey = 'upcoming' | 'past' | 'all';
type SourceFilter = 'all' | MappingSourceType;

export default function SchedulePage() {
  const { orgId, role, isSuperAdmin } = useAuth();
  const isOrgAdmin = role === 'org_admin' || isSuperAdmin;
  const isManager = role === 'manager' || isOrgAdmin;

  const [viewMode, setViewMode] = useState<ViewMode>('policies');
  const [unifiSubTab, setUnifiSubTab] = useState<'doors' | 'schedules'>('doors');

  // Access Policies State
  const [accessPolicies, setAccessPolicies] = useState<UnifiAccessPolicy[]>([]);
  const [policyMappings, setPolicyMappings] = useState<AccessPolicyMapping[]>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policySyncing, setPolicySyncing] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<UnifiAccessPolicy | null>(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [deletingPolicyName, setDeletingPolicyName] = useState<string | null>(null);
  const [deletePolicyModalOpen, setDeletePolicyModalOpen] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState(false);

  // UniFi Schedules State
  const [unifiSchedules, setUnifiSchedules] = useState<UnifiSchedule[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [unifiLoading, setUnifiLoading] = useState(true);
  const [unifiSyncing, setUnifiSyncing] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
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

  // Read URL query parameter for tab selection on initial load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get('tab');
      if (requestedTab === 'unifi' || requestedTab === 'schedules') {
        setViewMode('unifi');
      } else if (requestedTab === 'pco' || requestedTab === 'windows') {
        setViewMode('pco');
      } else if (requestedTab === 'policies') {
        setViewMode('policies');
      }
    }
  }, []);

  // Subscriptions
  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => setDoors(d));

    const unsubPolicies = subscribeToAccessPolicies(orgId, (p) => {
      setAccessPolicies(p);
      setPolicyLoading(false);
    });

    const unsubPolicyMappings = subscribeToAccessPolicyMappings(orgId, (pm) => {
      setPolicyMappings(pm);
    });

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
      unsubPolicies();
      unsubPolicyMappings();
      unsubUnifi();
      unsubPco();
    };
  }, [orgId]);

  // Sync Access Policies
  const handleSyncPolicies = useCallback(async () => {
    if (!orgId) return;
    setPolicySyncing(true);
    setFeedbackMessage(null);
    try {
      const syncFn = httpsCallable<{ orgId: string }, any>(functions, 'syncUnifiAccessPolicies');
      await syncFn({ orgId });
      setFeedbackMessage({
        text: 'Access policies synchronization requested from UniFi.',
        ok: true,
      });
    } catch (err: any) {
      setFeedbackMessage({
        text: `Policy sync failed: ${err.message || err}`,
        ok: false,
      });
    } finally {
      setPolicySyncing(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
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

  // Policy Modal Handlers
  const handleOpenCreatePolicy = useCallback(() => {
    setEditingPolicy(null);
    setPolicyModalOpen(true);
  }, []);

  const handleOpenEditPolicy = useCallback((policy: UnifiAccessPolicy) => {
    setEditingPolicy(policy);
    setPolicyModalOpen(true);
  }, []);

  const handleOpenDeletePolicy = useCallback((id: string, name: string) => {
    setDeletingPolicyId(id);
    setDeletingPolicyName(name);
    setDeletePolicyModalOpen(true);
  }, []);

  const handleDeletePolicyConfirm = useCallback(async () => {
    if (!orgId || !deletingPolicyId) return;
    setDeletingPolicy(true);
    try {
      const fn = httpsCallable<{ orgId: string; policyId: string; unifiPolicyId?: string }>(
        functions,
        'deleteUnifiAccessPolicy'
      );
      await fn({ orgId, policyId: deletingPolicyId });
      setDeletePolicyModalOpen(false);
      setFeedbackMessage({ text: 'Access policy deletion requested.', ok: true });
    } catch (err: any) {
      setFeedbackMessage({ text: err?.message || 'Failed to delete access policy.', ok: false });
    } finally {
      setDeletingPolicy(false);
      setTimeout(() => setFeedbackMessage(null), 5000);
    }
  }, [orgId, deletingPolicyId]);

  const validDoors = doors.filter((d) => {
    const label = (d.label || '').trim();
    if (!label) return false;
    if (isUuid(label) && d.current_state === 'unknown') return false;
    return true;
  });

  const validSchedules = unifiSchedules.filter((s) => {
    if (!s.id || s.id.trim() === '') return false;
    const hasActiveSlots = s.weekly_schedule?.some((d) => d.active && d.slots?.length > 0);
    const hasDoors = Boolean(s.door_ids && s.door_ids.length > 0);
    if (isUuid(s.name) && !hasActiveSlots && !hasDoors) return false;
    return true;
  });

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
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Schedules & Access Policies</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Manage weekly access policies, recurring door unlock hours, and Planning Center event windows.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {viewMode === 'policies' ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSyncPolicies}
                disabled={policySyncing}
                title="Sync access policy definitions from local UniFi console"
              >
                <RefreshIcon spinning={policySyncing} />
                {policySyncing ? 'Fetching…' : 'Fetch Policies'}
              </button>
              {isManager && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleOpenCreatePolicy}
                  title="Create a new UniFi Access Policy"
                >
                  <PlusIcon />
                  Create Policy
                </button>
              )}
            </>
          ) : viewMode === 'unifi' ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleSyncUnifi}
                disabled={unifiSyncing}
              >
                <RefreshIcon spinning={unifiSyncing} />
                {unifiSyncing ? 'Pulling UniFi…' : 'Pull UniFi Schedules'}
              </button>
              {isOrgAdmin && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setEditingSchedule(null);
                    setScheduleModalOpen(true);
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
                <RefreshIcon spinning={pcoSyncLoading} />
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

      {/* Primary View Toggle: Access Policies vs UniFi Schedules vs PCO Windows */}
      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab ${viewMode === 'policies' ? 'active' : ''}`}
          onClick={() => setViewMode('policies')}
        >
          Access Policies ({accessPolicies.length})
        </button>
        <button
          className={`tab ${viewMode === 'unifi' ? 'active' : ''}`}
          onClick={() => setViewMode('unifi')}
        >
          Door Unlock Schedules ({validSchedules.length})
        </button>
        <button
          className={`tab ${viewMode === 'pco' ? 'active' : ''}`}
          onClick={() => setViewMode('pco')}
        >
          Planning Center Windows ({allWindows.length})
        </button>
      </div>

      {/* ─── ACCESS POLICIES VIEW ─────────────────────────────────────────── */}
      {viewMode === 'policies' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                UniFi Access Policies ({accessPolicies.length})
              </h2>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.15rem' }}>
                Access policies group doors and weekly unlock schedules together, and can be assigned directly or mapped to Planning Center lists.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleSyncPolicies}
                disabled={policySyncing}
                title="Refresh policies from UniFi Access"
              >
                <RefreshIcon spinning={policySyncing} /> Refresh
              </button>
              {isManager && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleOpenCreatePolicy}
                >
                  <PlusIcon /> Create Policy
                </button>
              )}
            </div>
          </div>

          {policyLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', gap: '1rem' }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" style={{ height: '11rem', borderRadius: 'var(--radius-lg)' }} />
              ))}
            </div>
          ) : accessPolicies.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.5rem' }}>
                No Access Policies Found
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '30rem', margin: '0 auto 1.5rem' }}>
                Create your first UniFi access policy or click &quot;Fetch Policies&quot; to pull existing policies and door permissions from your UniFi console.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSyncPolicies}
                  disabled={policySyncing}
                >
                  <RefreshIcon spinning={policySyncing} />
                  {policySyncing ? 'Fetching…' : 'Fetch Policies from UniFi'}
                </button>
                {isManager && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleOpenCreatePolicy}
                  >
                    <PlusIcon /> Create Access Policy
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
              {accessPolicies.map((p) => {
                const polId = p.unifi_policy_id || p.id;
                const mappedLists = policyMappings.filter(
                  (pm) => pm.unifi_policy_id === polId || pm.unifi_policy_id === p.id
                );
                const matchingSchedule = unifiSchedules.find(
                  (s) => s.id === p.schedule_id || s.unifi_schedule_id === p.schedule_id
                );
                const scheduleLabel =
                  p.schedule_name || matchingSchedule?.name || (p.schedule_id ? 'Custom Schedule' : '24/7 Always Access');

                const assignedDoors = (p.door_ids || []).map((dId) => {
                  const found = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
                  return {
                    id: dId,
                    label: (found?.label || '').trim() || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId),
                    state: found?.current_state ?? 'unknown',
                  };
                });

                return (
                  <div
                    key={p.id}
                    className="card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      padding: '1.25rem',
                    }}
                  >
                    <div>
                      {/* Card Header */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.35rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                            {p.name}
                          </div>
                        </div>

                        <div>
                          {p.sync_status === 'pending' ? (
                            <span className="badge badge-warning" style={{ fontSize: '0.625rem' }}>Pending Sync</span>
                          ) : p.sync_status === 'error' ? (
                            <span className="badge badge-danger" style={{ fontSize: '0.625rem' }}>Sync Error</span>
                          ) : (
                            <span className="badge badge-success" style={{ fontSize: '0.625rem' }}>Synced</span>
                          )}
                        </div>
                      </div>

                      {p.description && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.625rem' }}>
                          {p.description}
                        </div>
                      )}

                      {/* Policy Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8125rem', marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ color: 'var(--color-text-muted)', minWidth: '4.5rem' }}>Schedule:</span>
                          <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                            🕒 {scheduleLabel}
                          </span>
                        </div>

                        <div>
                          <span style={{ color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                            Doors ({assignedDoors.length}):
                          </span>
                          {assignedDoors.length === 0 ? (
                            <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.75rem' }}>No doors assigned</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxHeight: '5.5rem', overflowY: 'auto' }}>
                              {assignedDoors.map((d, idx) => (
                                <span
                                  key={idx}
                                  className={`badge ${d.state === 'locked' ? 'badge-danger' : d.state === 'unlocked' ? 'badge-success' : 'badge-neutral'}`}
                                  style={{ fontSize: '0.6875rem' }}
                                >
                                  🚪 {d.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {mappedLists.length > 0 && (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--color-primary)' }}>
                            🔗 Mapped to <strong>{mappedLists.length}</strong> PCO list{mappedLists.length > 1 ? 's' : ''}:{' '}
                            {mappedLists.map((l) => l.pco_list_name).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: '0.75rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        {p.user_count !== undefined ? `${p.user_count} user(s)` : 'UniFi Policy'}
                      </span>

                      {isManager && (
                        <div style={{ display: 'flex', gap: '0.375rem' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                            onClick={() => handleOpenEditPolicy(p)}
                          >
                            <EditIcon /> Edit
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--color-danger)', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                            onClick={() => handleOpenDeletePolicy(p.id, p.name)}
                            title="Delete access policy"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                🚪 By Door ({validDoors.length})
              </button>
              <button
                className={`btn btn-sm ${unifiSubTab === 'schedules' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
                onClick={() => setUnifiSubTab('schedules')}
              >
                🗓️ All Schedules ({validSchedules.length})
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
            validDoors.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                <p style={{ color: 'var(--color-text-muted)' }}>No doors registered yet. Connect your agent to scan for doors.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(22rem, 1fr))', gap: '1.25rem' }}>
                {validDoors.map((door) => {
                  const doorSched = validSchedules.find(
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
                                setScheduleModalOpen(true);
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
                              🗓️ {getFriendlyScheduleName(doorSched.name, door.label)}
                            </div>

                            {/* Active Days Chips */}
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                              {WEEK_DAYS.map(({ key, letter }) => {
                                const dayConfig = doorSched.weekly_schedule?.find((d) => d.day === key);
                                const active = Boolean(dayConfig?.active && (dayConfig?.slots?.length ?? 0) > 0);
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
                                      border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                                    }}
                                    title={formatDayTooltip(dayConfig)}
                                  >
                                    {letter}
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                              {formatScheduleSummary(doorSched)}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: '0.75rem' }}>
                            No regular unlock schedule active. Door remains locked unless unlocked for a Planning Center service or manual hold.
                          </div>
                        )}
                      </div>

                      {/* Footer: assigned count & sync time */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)', paddingTop: '0.625rem', marginTop: '0.5rem' }}>
                        <span>
                          {doorSched?.door_ids?.length
                            ? `${doorSched.door_ids.length} door${doorSched.door_ids.length !== 1 ? 's' : ''} assigned`
                            : 'Door schedule'}
                        </span>
                        {doorSched?.last_synced && (
                          <span>Synced {format(new Date(doorSched.last_synced), 'MMM d, h:mm a')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : validSchedules.length === 0 ? (
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
                  <RefreshIcon spinning={unifiSyncing} />
                  {unifiSyncing ? 'Pulling from UniFi…' : 'Pull Schedules from UniFi'}
                </button>
                {isOrgAdmin && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEditingSchedule(null);
                      setScheduleModalOpen(true);
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
              {validSchedules.map((sched) => {
                const isUnlock = sched.type === 'unlock';
                const isPending = sched.sync_status === 'pending';
                const assignedCount = sched.door_ids?.length ?? 0;
                const displayName = getFriendlyScheduleName(sched.name);

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
                            {displayName}
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
                              setScheduleModalOpen(true);
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
                          const active = Boolean(dayConfig?.active && (dayConfig?.slots?.length ?? 0) > 0);
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
                              title={formatDayTooltip(dayConfig)}
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

      {/* Access Policy Create / Edit Modal */}
      {policyModalOpen && (
        <AccessPolicyModal
          isOpen={policyModalOpen}
          onClose={() => setPolicyModalOpen(false)}
          orgId={orgId || ''}
          policy={editingPolicy}
          doors={doors}
          schedules={unifiSchedules}
          onSaved={() => {
            setFeedbackMessage({
              text: editingPolicy ? 'Access policy updated successfully.' : 'New access policy created.',
              ok: true,
            });
            setTimeout(() => setFeedbackMessage(null), 4000);
          }}
        />
      )}

      {/* Access Policy Delete Confirmation Modal */}
      {deletePolicyModalOpen && (
        <Modal
          isOpen={deletePolicyModalOpen}
          onClose={() => setDeletePolicyModalOpen(false)}
          title="Delete UniFi Access Policy"
          footer={
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setDeletePolicyModalOpen(false)}
                disabled={deletingPolicy}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeletePolicyConfirm}
                disabled={deletingPolicy}
              >
                {deletingPolicy ? 'Deleting…' : 'Delete Policy'}
              </button>
            </div>
          }
        >
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            Are you sure you want to delete access policy <strong>&quot;{deletingPolicyName}&quot;</strong>?
            This will remove the policy from UniFi Access and unassign it from any linked Planning Center users.
          </p>
        </Modal>
      )}

      {/* Schedule Edit/Create Modal */}
      {scheduleModalOpen && (
        <UnifiScheduleModal
          isOpen={scheduleModalOpen}
          onClose={() => setScheduleModalOpen(false)}
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
