'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToScheduleWindows,
  subscribeToDoors,
  getOrgSettings,
  updateScheduleWindowReviewStatus,
  assignOneTimeScheduleWindowDoors,
  createMapping,
} from '@/lib/firestore';
import type {
  ScheduleWindow,
  Door,
  MappingSourceType,
  PlanTimeType,
  LockTimingMode,
  DoorTimingConfig,
  OrgSettings,
} from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { format } from 'date-fns';
import { safeIsPast, safeFormatDistanceToNow } from '@/lib/date-utils';
import { toZonedTime } from 'date-fns-tz';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

// ─── Icons ────────────────────────────────────────────────────────────────────

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
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

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function AlertTriangleIcon({ color = 'var(--color-warning)' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatWindowTime(iso: string, tz: string): string {
  try {
    const zoned = toZonedTime(new Date(iso), tz);
    return format(zoned, 'EEE, MMM d, yyyy · h:mm a');
  } catch {
    return format(new Date(iso), 'EEE, MMM d, yyyy · h:mm a');
  }
}

function isUrgent(startsAtIso: string): boolean {
  try {
    const startMs = new Date(startsAtIso).getTime();
    const diffHours = (startMs - Date.now()) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 48;
  } catch {
    return false;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UnmappedEventsTab() {
  const { orgId, profile, role, isSuperAdmin } = useAuth();
  const { showToast } = useToast();
  const isManager = role === 'org_admin' || role === 'manager' || isSuperAdmin;

  // Data state
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [timezone, setTimezone] = useState<string>('America/Chicago');
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);

  // Filters & Tabs
  const [tab, setTab] = useState<'unreviewed' | 'dismissed' | 'all'>('unreviewed');
  const [daysAhead, setDaysAhead] = useState<number>(30);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'service' | 'group'>('all');
  const [timeTypeFilter, setTimeTypeFilter] = useState<'all' | 'service' | 'rehearsal' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selection state for batch actions
  const [selectedWindowIds, setSelectedWindowIds] = useState<string[]>([]);

  // Org Settings
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);

  // Wizard Modals state
  const [mappingModalWindow, setMappingModalWindow] = useState<ScheduleWindow | null>(null);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [mappingMode, setMappingMode] = useState<'one_time' | 'recurring'>('one_time');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [doorSearch, setDoorSearch] = useState<string>('');
  const [selectedCampusFilter, setSelectedCampusFilter] = useState<string>('all');
  const [timingChoice, setTimingChoice] = useState<'default' | 'after_start' | 'after_end'>('default');
  const [unlockOffsetMin, setUnlockOffsetMin] = useState<number>(15);
  const [lockOffsetMin, setLockOffsetMin] = useState<number>(15);
  const [lockTimingMode, setLockTimingMode] = useState<LockTimingMode>('after_end');
  const [doorTimings, setDoorTimings] = useState<Record<string, DoorTimingConfig>>({});
  const [timeTypes, setTimeTypes] = useState<PlanTimeType[]>(['service']);
  const [savingMapping, setSavingMapping] = useState<boolean>(false);

  const [dismissModalWindow, setDismissModalWindow] = useState<ScheduleWindow | null>(null);
  const [dismissReason, setDismissReason] = useState<string>('Online Event Only');
  const [customReason, setCustomReason] = useState<string>('');
  const [savingDismiss, setSavingDismiss] = useState<boolean>(false);

  // Load Firestore data
  useEffect(() => {
    if (!orgId) return;

    getOrgSettings(orgId).then((settings) => {
      setOrgSettings(settings);
      if (settings?.timezone) setTimezone(settings.timezone);
      if (settings?.unlock_buffer_before_min) setUnlockOffsetMin(settings.unlock_buffer_before_min);
      if (settings?.lock_buffer_after_min) setLockOffsetMin(settings.lock_buffer_after_min);
    });

    const unsubWindows = subscribeToScheduleWindows(orgId, (w) => {
      setScheduleWindows(w);
      setLoading(false);
    });

    const unsubDoors = subscribeToDoors(orgId, (d) => {
      setDoors(d);
    });

    return () => {
      unsubWindows();
      unsubDoors();
    };
  }, [orgId]);

  // Sync handler
  const handleSyncNow = useCallback(async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      const triggerFn = httpsCallable<{ orgId: string }, any>(functions, 'triggerPcoSync');
      await triggerFn({ orgId });
      showToast('Planning Center schedule sync completed.', 'success');
    } catch (err: any) {
      console.error('Failed to sync PCO schedule:', err);
      showToast(`Sync failed: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setSyncing(false);
    }
  }, [orgId, showToast]);

  // Derived windows lists
  const now = new Date();
  const maxFutureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const upcomingWindows = useMemo(() => {
    return scheduleWindows.filter((w) => {
      if (safeIsPast(w.lock_at) || w.status === 'cancelled') return false;
      const startMs = new Date(w.starts_at).getTime();
      return startMs <= maxFutureDate.getTime();
    });
  }, [scheduleWindows, maxFutureDate]);

  const unreviewedWindows = useMemo(() => {
    return upcomingWindows.filter(
      (w) => (!w.door_ids || w.door_ids.length === 0) && w.review_status !== 'dismissed'
    );
  }, [upcomingWindows]);

  const urgentCount = useMemo(() => {
    return unreviewedWindows.filter((w) => isUrgent(w.starts_at)).length;
  }, [unreviewedWindows]);

  const thisWeekCount = useMemo(() => {
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).getTime();
    return unreviewedWindows.filter((w) => new Date(w.starts_at).getTime() <= weekFromNow).length;
  }, [unreviewedWindows, now]);

  const dismissedWindows = useMemo(() => {
    return upcomingWindows.filter((w) => w.review_status === 'dismissed');
  }, [upcomingWindows]);

  // Filtered displayed windows according to current tab & criteria
  const displayedWindows = useMemo(() => {
    let sourceList = upcomingWindows;

    if (tab === 'unreviewed') {
      sourceList = unreviewedWindows;
    } else if (tab === 'dismissed') {
      sourceList = dismissedWindows;
    }

    return sourceList.filter((w) => {
      if (sourceFilter !== 'all' && w.source_type !== sourceFilter) return false;
      
      if (timeTypeFilter !== 'all') {
        const isRehearsal = w.time_type === 'rehearsal' || w.source_label.toLowerCase().includes('(rehearsal)');
        const isService = w.time_type === 'service' || (!isRehearsal && w.source_type === 'service');
        if (timeTypeFilter === 'service' && !isService) return false;
        if (timeTypeFilter === 'rehearsal' && !isRehearsal) return false;
        if (timeTypeFilter === 'other' && (isService || isRehearsal)) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const labelMatch = w.source_label.toLowerCase().includes(q);
        const doorMatch = w.door_labels.some((l) => l.toLowerCase().includes(q));
        const reasonMatch = w.dismissed_reason?.toLowerCase().includes(q);
        if (!labelMatch && !doorMatch && !reasonMatch) return false;
      }
      return true;
    });
  }, [upcomingWindows, unreviewedWindows, dismissedWindows, tab, sourceFilter, timeTypeFilter, searchQuery]);

  // Checkbox batch selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedWindowIds(displayedWindows.map((w) => w.id));
    } else {
      setSelectedWindowIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedWindowIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Bulk dismiss
  const handleBulkDismiss = async () => {
    if (!orgId || selectedWindowIds.length === 0) return;
    try {
      await Promise.all(
        selectedWindowIds.map((id) =>
          updateScheduleWindowReviewStatus(orgId, id, {
            review_status: 'dismissed',
            dismissed_reason: 'Bulk dismissed by user',
            dismissed_by: profile?.display_name || 'Admin',
          })
        )
      );
      showToast(`Dismissed ${selectedWindowIds.length} event(s).`, 'success');
      setSelectedWindowIds([]);
    } catch (err: any) {
      showToast(`Bulk dismiss failed: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  // Open Quick Map Modal Wizard
  const handleOpenMapModal = (win: ScheduleWindow) => {
    setMappingModalWindow(win);
    setWizardStep(1);
    setMappingMode('one_time');
    setSelectedDoorIds(win.door_ids || []);
    setDoorSearch('');
    setSelectedCampusFilter('all');

    const defaultUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
    const defaultLock = orgSettings?.lock_buffer_after_min ?? 15;
    setTimingChoice('default');
    setUnlockOffsetMin(defaultUnlock);
    setLockOffsetMin(defaultLock);
    setLockTimingMode('after_end');
    setDoorTimings(win.door_timings ? JSON.parse(JSON.stringify(win.door_timings)) : {});

    const isRehearsal = win.time_type === 'rehearsal' || win.source_label.toLowerCase().includes('(rehearsal)');
    setTimeTypes([win.time_type || (isRehearsal ? 'rehearsal' : 'service')]);
  };

  // Door filtering for wizard
  const isUuid = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());

  const isAdmin = role === 'org_admin' || isSuperAdmin;

  const validDoors = useMemo(() => {
    return doors.filter((d) => {
      const label = (d.label || '').trim();
      if (!label) return false;
      if (isUuid(label) && d.current_state === 'unknown') return false;
      if (!isAdmin && isDoorHidden(d)) return false;
      return true;
    });
  }, [doors, isAdmin]);

  const campusOptions = useMemo(() => {
    const set = new Set<string>();
    validDoors.forEach((d) => {
      if (d.campus_name) set.add(d.campus_name);
    });
    return Array.from(set).sort();
  }, [validDoors]);

  const filteredDoors = useMemo(() => {
    return validDoors.filter((d) => {
      if (selectedCampusFilter === 'unassigned') {
        if (d.campus_name || d.campus_id) return false;
      } else if (selectedCampusFilter !== 'all') {
        if (d.campus_name !== selectedCampusFilter && d.campus_id !== selectedCampusFilter) return false;
      }

      if (!doorSearch.trim()) return true;
      const q = doorSearch.toLowerCase();
      return (
        (d.label && d.label.toLowerCase().includes(q)) ||
        (d.campus_name && d.campus_name.toLowerCase().includes(q)) ||
        (d.location_name && d.location_name.toLowerCase().includes(q)) ||
        (d.floor && d.floor.toLowerCase().includes(q)) ||
        (d.building && d.building.toLowerCase().includes(q))
      );
    });
  }, [validDoors, selectedCampusFilter, doorSearch]);

  const orgMode = orgSettings?.lock_timing_mode ?? 'after_end';
  const orgUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
  const orgLock = orgMode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15);

  const effectiveDefaultUnlock = timingChoice !== 'default' ? unlockOffsetMin : orgUnlock;
  const effectiveDefaultLock = timingChoice !== 'default' ? lockOffsetMin : orgLock;
  const effectiveDefaultMode = timingChoice !== 'default' ? (timingChoice === 'after_start' ? 'after_start' : 'after_end') : orgMode;

  // Save Mapping (One-Time or Recurring)
  const handleSaveMapping = async () => {
    if (!orgId || !mappingModalWindow) return;
    if (selectedDoorIds.length === 0) {
      showToast('Please select at least one door to map.', 'error');
      return;
    }

    setSavingMapping(true);
    const doorLabels = selectedDoorIds.map(
      (id) => doors.find((d) => d.id === id || d.unifi_door_id === id)?.label || id
    );

    // Clean per-door timings for only selected doors
    const cleanedDoorTimings: Record<string, DoorTimingConfig> = {};
    for (const dId of selectedDoorIds) {
      if (doorTimings[dId]) {
        cleanedDoorTimings[dId] = {
          lock_timing_mode: doorTimings[dId].lock_timing_mode,
          lock_offset_min: doorTimings[dId].lock_offset_min,
          unlock_offset_min: doorTimings[dId].unlock_offset_min,
        };
      }
    }

    try {
      if (mappingMode === 'one_time') {
        // Assign doors specifically to this one-time window
        await assignOneTimeScheduleWindowDoors(orgId, mappingModalWindow.id, {
          door_ids: selectedDoorIds,
          door_labels: doorLabels,
          unlock_offset_min: timingChoice === 'default' ? undefined : unlockOffsetMin,
          lock_offset_min: timingChoice === 'default' ? undefined : lockOffsetMin,
          lock_timing_mode: timingChoice === 'default' ? undefined : (timingChoice === 'after_start' ? 'after_start' : 'after_end'),
          door_timings: Object.keys(cleanedDoorTimings).length > 0 ? cleanedDoorTimings : undefined,
        });

        showToast('Doors assigned to event window successfully.', 'success');
      } else {
        // Create permanent recurring service/group mapping
        const resourceId =
          mappingModalWindow.pco_service_type_id ||
          mappingModalWindow.pco_group_id ||
          mappingModalWindow.pco_plan_id ||
          mappingModalWindow.pco_event_id;

        if (!resourceId) {
          throw new Error('Resource ID not found on schedule window for recurring mapping.');
        }

        await createMapping(orgId, {
          source_type: mappingModalWindow.source_type,
          pco_resource_id: resourceId,
          pco_resource_label: mappingModalWindow.source_label.split(':')[0] || mappingModalWindow.source_label,
          door_ids: selectedDoorIds,
          door_labels: doorLabels,
          time_types: mappingModalWindow.source_type === 'service' ? timeTypes : undefined,
          unlock_offset_min: timingChoice === 'default' ? undefined : unlockOffsetMin,
          lock_offset_min: timingChoice === 'default' ? undefined : lockOffsetMin,
          lock_timing_mode: timingChoice === 'default' ? undefined : (timingChoice === 'after_start' ? 'after_start' : 'after_end'),
          door_timings: Object.keys(cleanedDoorTimings).length > 0 ? cleanedDoorTimings : undefined,
          enabled: true,
        });

        showToast('Recurring door mapping created. Triggering background schedule update...', 'success');
      }

      // Trigger background sync to refresh schedule windows and commands
      const triggerFn = httpsCallable<{ orgId: string }, any>(functions, 'triggerPcoSync');
      triggerFn({ orgId }).catch((e) => console.warn('Background sync after map failed:', e));

      setMappingModalWindow(null);
    } catch (err: any) {
      console.error('Failed to map doors:', err);
      showToast(`Failed to map doors: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setSavingMapping(false);
    }
  };

  // Dismiss Single Event
  const handleConfirmDismiss = async () => {
    if (!orgId || !dismissModalWindow) return;
    setSavingDismiss(true);

    const finalReason = dismissReason === 'Other' ? customReason.trim() || 'Other' : dismissReason;

    try {
      await updateScheduleWindowReviewStatus(orgId, dismissModalWindow.id, {
        review_status: 'dismissed',
        dismissed_reason: finalReason,
        dismissed_by: profile?.display_name || 'Admin',
      });
      showToast('Event marked as dismissed (no doors required).', 'success');
      setDismissModalWindow(null);
    } catch (err: any) {
      showToast(`Failed to dismiss event: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setSavingDismiss(false);
    }
  };

  // Restore Dismissed Event back to Unreviewed
  const handleRestoreEvent = async (win: ScheduleWindow) => {
    if (!orgId) return;
    try {
      await updateScheduleWindowReviewStatus(orgId, win.id, {
        review_status: 'unreviewed',
      });
      showToast('Event restored to review queue.', 'success');
    } catch (err: any) {
      showToast(`Failed to restore event: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  return (
    <>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.625rem', margin: 0 }}>
            Unmapped Upcoming Events
            {unreviewedWindows.length > 0 && (
              <span className="badge badge-warning" style={{ fontSize: '0.8125rem', padding: '0.2rem 0.6rem' }}>
                {unreviewedWindows.length} Needs Review
              </span>
            )}
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Review upcoming Planning Center plans and group events that do not have door schedule access mapped.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSyncNow}
            disabled={syncing}
            title="Fetch latest events from Planning Center"
          >
            <RefreshIcon spinning={syncing} />
            {syncing ? 'Syncing...' : 'Sync PCO Events'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid var(--color-danger)' }}>
          <div style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '0.75rem', borderRadius: '50%', color: 'var(--color-danger)' }}>
            <AlertTriangleIcon color="var(--color-danger)" />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--color-text-primary)' }}>
              {urgentCount}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Urgent (&lt; 48 hours)
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid var(--color-warning)' }}>
          <div style={{ background: 'rgba(245, 158, 11, 0.12)', padding: '0.75rem', borderRadius: '50%', color: 'var(--color-warning)' }}>
            <CalendarIcon />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--color-text-primary)' }}>
              {thisWeekCount}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Next 7 Days
            </div>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid var(--color-accent)' }}>
          <div style={{ background: 'rgba(36, 101, 245, 0.12)', padding: '0.75rem', borderRadius: '50%', color: 'var(--color-accent)' }}>
            <MapPinIcon />
          </div>
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--color-text-primary)' }}>
              {unreviewedWindows.length}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Total Unmapped ({daysAhead}d horizon)
            </div>
          </div>
        </div>
      </div>

      {/* Controls Bar: Tabs, Search & Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--color-bg-base)', padding: '0.25rem', borderRadius: 'var(--radius-md)' }}>
            <button
              className={`btn btn-sm ${tab === 'unreviewed' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab('unreviewed'); setSelectedWindowIds([]); }}
            >
              Needs Review ({unreviewedWindows.length})
            </button>
            <button
              className={`btn btn-sm ${tab === 'dismissed' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab('dismissed'); setSelectedWindowIds([]); }}
            >
              Dismissed ({dismissedWindows.length})
            </button>
            <button
              className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab('all'); setSelectedWindowIds([]); }}
            >
              All Upcoming ({upcomingWindows.length})
            </button>
          </div>

          {/* Filters & Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search by event title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '14rem', height: '2.125rem', fontSize: '0.8125rem' }}
            />

            <select
              className="form-select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as any)}
              style={{ width: '9rem', height: '2.125rem', fontSize: '0.8125rem' }}
            >
              <option value="all">All Sources</option>
              <option value="service">Services Only</option>
              <option value="group">Groups Only</option>
            </select>

            <select
              className="form-select"
              value={timeTypeFilter}
              onChange={(e) => setTimeTypeFilter(e.target.value as any)}
              style={{ width: '11.5rem', height: '2.125rem', fontSize: '0.8125rem' }}
              title="Filter by Plan Time Type"
            >
              <option value="all">All Time Types</option>
              <option value="service">⛪ Services Only (exclude rehearsals)</option>
              <option value="rehearsal">🎵 Rehearsals Only</option>
              <option value="other">🕒 Other Times Only</option>
            </select>

            <select
              className="form-select"
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
              style={{ width: '9.5rem', height: '2.125rem', fontSize: '0.8125rem' }}
            >
              <option value={7}>Next 7 Days</option>
              <option value={14}>Next 14 Days</option>
              <option value={30}>Next 30 Days</option>
              <option value={90}>Next 90 Days</option>
            </select>
          </div>
        </div>

        {/* Batch action bar if items selected */}
        {selectedWindowIds.length > 0 && isManager && (
          <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
              {selectedWindowIds.length} event(s) selected
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleBulkDismiss}
              style={{ color: 'var(--color-warning)' }}
            >
              <EyeOffIcon />
              Dismiss Selected as No Doors Required
            </button>
          </div>
        )}
      </div>

      {/* Main Table / List */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Loading upcoming events...
          </div>
        ) : displayedWindows.length === 0 ? (
          <div style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>
            <div style={{ width: '3rem', height: '3rem', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', color: 'var(--color-success)' }}>
              <CheckCircleIcon />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
              {tab === 'unreviewed' ? 'All Upcoming Events Mapped!' : 'No Events Found'}
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.5rem', maxWidth: '28rem', margin: '0.5rem auto 0' }}>
              {tab === 'unreviewed'
                ? 'There are no unmapped events needing door schedule review in the selected time range.'
                : 'No events match your current filter settings.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                  {isManager && tab === 'unreviewed' && (
                    <th style={{ padding: '0.75rem 1rem', width: '2.5rem' }}>
                      <input
                        type="checkbox"
                        checked={
                          displayedWindows.length > 0 &&
                          selectedWindowIds.length === displayedWindows.length
                        }
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                  )}
                  <th style={{ padding: '0.75rem 1rem' }}>Source</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Event / Title</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Date & Time</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Mapping Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedWindows.map((win) => {
                  const urgent = isUrgent(win.starts_at);
                  const isSelected = selectedWindowIds.includes(win.id);

                  return (
                    <tr
                      key={win.id}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: isSelected
                          ? 'rgba(36, 101, 245, 0.05)'
                          : urgent
                          ? 'rgba(239, 68, 68, 0.03)'
                          : 'transparent',
                      }}
                    >
                      {isManager && tab === 'unreviewed' && (
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(win.id)}
                          />
                        </td>
                      )}

                      {(() => {
                        const isRehearsal = win.time_type === 'rehearsal' || win.source_label.toLowerCase().includes('(rehearsal)');
                        const isServiceTime = win.time_type === 'service' || win.source_label.toLowerCase().includes('(service)');

                        return (
                          <>
                            <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                                <span className={`badge ${win.source_type === 'service' ? 'badge-info' : 'badge-neutral'}`}>
                                  {win.source_type === 'service' ? 'Service' : 'Group'}
                                </span>
                                {isRehearsal && (
                                  <span
                                    style={{
                                      fontSize: '0.6875rem',
                                      padding: '0.125rem 0.375rem',
                                      borderRadius: 'var(--radius-sm)',
                                      background: 'rgba(139, 92, 246, 0.15)',
                                      color: '#8b5cf6',
                                      border: '1px solid rgba(139, 92, 246, 0.3)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Rehearsal
                                  </span>
                                )}
                                {isServiceTime && (
                                  <span
                                    style={{
                                      fontSize: '0.6875rem',
                                      padding: '0.125rem 0.375rem',
                                      borderRadius: 'var(--radius-sm)',
                                      background: 'rgba(34, 197, 94, 0.15)',
                                      color: 'var(--color-success)',
                                      border: '1px solid rgba(34, 197, 94, 0.3)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    Service Time
                                  </span>
                                )}
                              </div>
                            </td>

                            <td style={{ padding: '0.75rem 1rem' }}>
                              <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                {win.source_label}
                              </div>
                              {win.dismissed_reason && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                                  Dismissed note: <em>{win.dismissed_reason}</em>
                                </div>
                              )}
                            </td>

                            <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                              <div style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                                {formatWindowTime(win.starts_at, timezone)}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: isRehearsal ? '#8b5cf6' : 'var(--color-text-muted)', marginTop: '0.15rem', fontWeight: isRehearsal ? 500 : 400 }}>
                                {isRehearsal ? '🎵 Rehearsal Time' : isServiceTime ? '⛪ Service Time' : 'Event Time'}
                              </div>
                              {urgent && (
                                <span className="badge badge-danger" style={{ fontSize: '0.6875rem', marginTop: '0.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <AlertTriangleIcon color="currentColor" /> Starts in &lt; 48h
                                </span>
                              )}
                            </td>
                          </>
                        );
                      })()}

                      <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                        {win.door_labels && win.door_labels.length > 0 ? (
                          <span className="badge badge-success">
                            🚪 {win.door_labels.join(', ')}
                          </span>
                        ) : win.review_status === 'dismissed' ? (
                          <span className="badge badge-neutral" style={{ opacity: 0.8 }}>
                            👁️ Dismissed
                          </span>
                        ) : (
                          <span className="badge badge-warning">
                            ⚠️ Unmapped
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isManager && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            {win.review_status === 'dismissed' ? (
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleRestoreEvent(win)}
                                title="Restore to review queue"
                              >
                                Restore
                              </button>
                            ) : (
                              <>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleOpenMapModal(win)}
                                >
                                  <MapPinIcon />
                                  Map Doors
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => {
                                    setDismissModalWindow(win);
                                    setDismissReason('Online Event Only');
                                    setCustomReason('');
                                  }}
                                  title="Flag event as not requiring door schedule"
                                >
                                  Dismiss
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Map Doors Wizard */}
      {mappingModalWindow && (() => {
        const totalSteps = 4;
        const stepLabels: Record<number, string> = {
          1: 'Scope & Details',
          2: 'Select Doors',
          3: 'Timing & Rules',
          4: 'Review & Confirm',
        };

        const handleSelectAllDoors = () => {
          setSelectedDoorIds(validDoors.map((d) => d.id));
        };

        const handleSelectCampusDoors = (campusName: string) => {
          const campusDoorIds = validDoors
            .filter((d) => (campusName === 'unassigned' ? !d.campus_name && !d.campus_id : d.campus_name === campusName || d.campus_id === campusName))
            .map((d) => d.id);
          setSelectedDoorIds((prev) => Array.from(new Set([...prev, ...campusDoorIds])));
        };

        const handleDeselectAllDoors = () => {
          setSelectedDoorIds([]);
        };

        const toggleDoor = (id: string) => {
          setSelectedDoorIds((prev) =>
            prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
          );
        };

        const toggleTimeType = (tt: PlanTimeType) => {
          setTimeTypes((prev) =>
            prev.includes(tt) ? prev.filter((t) => t !== tt) : [...prev, tt]
          );
        };

        return (
          <Modal
            isOpen={true}
            onClose={() => setMappingModalWindow(null)}
            title={`Map Doors: ${mappingModalWindow.source_label}`}
            maxWidth="40rem"
            footer={
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <button
                  className="btn btn-secondary"
                  onClick={wizardStep === 1 ? () => setMappingModalWindow(null) : () => setWizardStep((s) => s - 1)}
                  disabled={savingMapping}
                >
                  {wizardStep === 1 ? 'Cancel' : '← Back'}
                </button>

                {wizardStep < totalSteps ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => setWizardStep((s) => s + 1)}
                    disabled={
                      (wizardStep === 2 && selectedDoorIds.length === 0) ||
                      (wizardStep === 1 && mappingMode === 'recurring' && mappingModalWindow.source_type === 'service' && timeTypes.length === 0)
                    }
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveMapping}
                    disabled={savingMapping || selectedDoorIds.length === 0}
                  >
                    {savingMapping ? 'Saving...' : 'Apply Door Schedule'}
                  </button>
                )}
              </div>
            }
          >
            {/* Step Progress Indicators */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center' }}>
              {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                <React.Fragment key={s}>
                  <div
                    style={{
                      width: '1.5rem',
                      height: '1.5rem',
                      borderRadius: '50%',
                      background: s <= wizardStep ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
                      border: `2px solid ${s <= wizardStep ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: s <= wizardStep ? '#fff' : 'var(--color-text-muted)',
                      transition: 'all 0.2s ease',
                      flexShrink: 0,
                    }}
                  >
                    {s}
                  </div>
                  {s < totalSteps && (
                    <div
                      style={{
                        flex: 1,
                        height: '2px',
                        background: s < wizardStep ? 'var(--color-accent)' : 'var(--color-border)',
                        transition: 'background 0.2s ease',
                      }}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>

            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                marginBottom: '1rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              Step {wizardStep}: {stepLabels[wizardStep]}
            </div>

            {/* STEP 1: Scope & Details */}
            {wizardStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Event Time Info */}
                <div
                  style={{
                    background: 'var(--color-bg-base)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Event Window
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: '3.5rem' }}>Name:</span>
                      <strong style={{ color: 'var(--color-text-primary)' }}>{mappingModalWindow.source_label}</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: '3.5rem' }}>Start:</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {formatWindowTime(mappingModalWindow.starts_at, timezone)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text-muted)', minWidth: '3.5rem' }}>End:</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {formatWindowTime(mappingModalWindow.ends_at, timezone)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mode selection */}
                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>Mapping Scope</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.75rem' }}>
                    <button
                      type="button"
                      className={`btn ${mappingMode === 'one_time' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setMappingMode('one_time')}
                      style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0.75rem', height: 'auto', whiteSpace: 'normal' }}
                    >
                      <span style={{ fontWeight: 600 }}>One-Time Override</span>
                      <span style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '0.25rem', lineHeight: 1.3 }}>
                        Assign doors only for this specific event instance.
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`btn ${mappingMode === 'recurring' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setMappingMode('recurring')}
                      style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0.75rem', height: 'auto', whiteSpace: 'normal' }}
                    >
                      <span style={{ fontWeight: 600 }}>Recurring Mapping</span>
                      <span style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '0.25rem', lineHeight: 1.3 }}>
                        Save mapping for all future instances of this {mappingModalWindow.source_type}.
                      </span>
                    </button>
                  </div>
                </div>

                {/* Time Types Checkboxes for recurring service mapping */}
                {mappingModalWindow.source_type === 'service' && mappingMode === 'recurring' && (
                  <div className="form-group">
                    <label className="form-label" style={{ fontWeight: 600 }}>
                      Which plan times should this recurring mapping trigger for?
                    </label>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {(['service', 'rehearsal', 'other'] as PlanTimeType[]).map((tt) => (
                        <label
                          key={tt}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.375rem',
                            cursor: 'pointer',
                            fontSize: '0.8125rem',
                            padding: '0.375rem 0.625rem',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${timeTypes.includes(tt) ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            background: timeTypes.includes(tt) ? 'rgba(36, 101, 245, 0.1)' : 'transparent',
                            fontWeight: timeTypes.includes(tt) ? 600 : 400,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={timeTypes.includes(tt)}
                            onChange={() => toggleTimeType(tt)}
                          />
                          <span style={{ textTransform: 'capitalize' }}>
                            {tt === 'service' ? '⛪ Service Time' : tt === 'rehearsal' ? '🎵 Rehearsal Time' : '🕒 Other Times'}
                          </span>
                        </label>
                      ))}
                    </div>
                    {timeTypes.length === 0 && (
                      <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>
                        Please select at least one time type to trigger.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Door Selection with Campus Filter & Search */}
            {wizardStep === 2 && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <label className="form-label" style={{ marginBottom: 0, display: 'block', fontWeight: 600 }}>
                    Select UniFi Doors ({selectedDoorIds.length} of {validDoors.length} selected)
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {campusOptions.length > 0 && selectedCampusFilter !== 'all' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto', color: 'var(--color-accent)' }}
                        onClick={() => handleSelectCampusDoors(selectedCampusFilter)}
                        title={`Select all doors in ${selectedCampusFilter}`}
                      >
                        Select All {selectedCampusFilter === 'unassigned' ? 'Unassigned' : selectedCampusFilter}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                      onClick={handleSelectAllDoors}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                      onClick={handleDeselectAllDoors}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Campus Filter Chips */}
                {campusOptions.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${selectedCampusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
                      onClick={() => setSelectedCampusFilter('all')}
                    >
                      All Campuses ({validDoors.length})
                    </button>
                    {campusOptions.map((c) => {
                      const count = validDoors.filter((d) => d.campus_name === c || d.campus_id === c).length;
                      return (
                        <button
                          key={c}
                          type="button"
                          className={`btn btn-sm ${selectedCampusFilter === c ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
                          onClick={() => setSelectedCampusFilter(c)}
                        >
                          🏫 {c} ({count})
                        </button>
                      );
                    })}
                    {validDoors.some((d) => !d.campus_name && !d.campus_id) && (
                      <button
                        type="button"
                        className={`btn btn-sm ${selectedCampusFilter === 'unassigned' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
                        onClick={() => setSelectedCampusFilter('unassigned')}
                      >
                        Unassigned ({validDoors.filter((d) => !d.campus_name && !d.campus_id).length})
                      </button>
                    )}
                  </div>
                )}

                {validDoors.length > 6 && (
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Filter doors by name, campus, location, building…"
                    value={doorSearch}
                    onChange={(e) => setDoorSearch(e.target.value)}
                    style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
                  />
                )}

                {validDoors.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                    No doors available. Configure doors in Settings/Hardware first.
                  </p>
                ) : filteredDoors.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '0.75rem', textAlign: 'center' }}>
                    No doors match the selected filter.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '16rem', overflowY: 'auto' }}>
                    {filteredDoors.map((door) => {
                      const checked = selectedDoorIds.includes(door.id) || selectedDoorIds.includes(door.unifi_door_id);
                      return (
                        <label
                          key={door.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.625rem',
                            padding: '0.625rem',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                            background: checked ? 'rgba(36,101,245,0.1)' : 'var(--color-bg-base)',
                            border: `1px solid ${checked ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                            transition: 'all 0.15s ease',
                            fontSize: '0.875rem',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDoor(door.id)}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '0.125rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                              <span style={{ color: 'var(--color-text-primary)', fontWeight: checked ? 600 : 500 }}>
                                {door.label}
                              </span>
                              {isDoorHidden(door) && (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: '0.625rem',
                                    padding: '0.05rem 0.3rem',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    color: 'var(--color-danger)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    fontWeight: 600,
                                  }}
                                >
                                  Hidden
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                              {door.campus_name && (
                                <span
                                  style={{
                                    fontSize: '0.6875rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: 'var(--radius-sm, 4px)',
                                    background: 'rgba(36, 101, 245, 0.1)',
                                    color: 'var(--color-accent, #2465f5)',
                                    border: '1px solid rgba(36, 101, 245, 0.2)',
                                    fontWeight: 500,
                                  }}
                                >
                                  🏫 {door.campus_name}
                                </span>
                              )}
                              {door.location_name && (
                                <span
                                  style={{
                                    fontSize: '0.6875rem',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: 'var(--radius-sm, 4px)',
                                    background: 'rgba(168, 85, 247, 0.1)',
                                    color: '#9333ea',
                                    border: '1px solid rgba(168, 85, 247, 0.2)',
                                    fontWeight: 500,
                                  }}
                                >
                                  📍 {door.location_name}
                                </span>
                              )}
                              {(door.building || door.floor) && (
                                <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                                  {[door.building, door.floor].filter(Boolean).join(' · ')}
                                </span>
                              )}
                            </div>
                          </div>
                          <span
                            className={`badge ${
                              door.current_state === 'locked' ? 'badge-danger' :
                              door.current_state === 'unlocked' ? 'badge-success' :
                              'badge-neutral'
                            }`}
                            style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}
                          >
                            {door.current_state}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedDoorIds.length === 0 && (
                  <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.75rem', marginTop: '0.5rem', display: 'block' }}>
                    Please select at least one door to continue.
                  </span>
                )}
              </div>
            )}

            {/* STEP 3: Timing & Rules (Presets + Overrides) */}
            {wizardStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Baseline Locking Rule */}
                <div
                  style={{
                    padding: '0.875rem',
                    background: 'var(--color-bg-base)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
                    Baseline Door Locking Rule
                  </label>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="timingChoice"
                        value="default"
                        checked={timingChoice === 'default'}
                        onChange={() => setTimingChoice('default')}
                      />
                      <span>
                        Org Default ({orgMode === 'after_start' ? '🛡️ Security Mode' : '🕒 Standard Mode'} · {orgMode === 'after_start' ? `+${orgLock}m after start` : `+${orgLock}m after end`})
                      </span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="timingChoice"
                        value="after_start"
                        checked={timingChoice === 'after_start'}
                        onChange={() => setTimingChoice('after_start')}
                      />
                      <span style={{ fontWeight: timingChoice === 'after_start' ? 600 : 400 }}>
                        🛡️ Security Mode (Lock shortly after event starts)
                      </span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="timingChoice"
                        value="after_end"
                        checked={timingChoice === 'after_end'}
                        onChange={() => setTimingChoice('after_end')}
                      />
                      <span style={{ fontWeight: timingChoice === 'after_end' ? 600 : 400 }}>
                        🕒 Standard Mode (Lock after event ends)
                      </span>
                    </label>
                  </div>

                  {timingChoice !== 'default' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span>Unlock before:</span>
                          <strong style={{ color: 'var(--color-accent)' }}>{unlockOffsetMin}m</strong>
                        </div>
                        <input
                          type="range"
                          className="form-range"
                          min="0"
                          max="60"
                          step="5"
                          value={unlockOffsetMin}
                          onChange={(e) => setUnlockOffsetMin(Number(e.target.value))}
                        />
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                          <span>{timingChoice === 'after_start' ? 'Lock after start:' : 'Lock after end:'}</span>
                          <strong style={{ color: 'var(--color-accent)' }}>{lockOffsetMin}m</strong>
                        </div>
                        <input
                          type="range"
                          className="form-range"
                          min="0"
                          max={timingChoice === 'after_start' ? '120' : '60'}
                          step="5"
                          value={lockOffsetMin}
                          onChange={(e) => setLockOffsetMin(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Per-Door Timing Overrides (Optional) */}
                {selectedDoorIds.length > 0 && (
                  <div
                    style={{
                      padding: '0.875rem',
                      background: 'var(--color-bg-base)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
                        Per-Door Timing Overrides (Optional)
                      </label>
                      {Object.keys(doorTimings).length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', color: 'var(--color-text-muted)' }}
                          onClick={() => setDoorTimings({})}
                        >
                          Reset All to Default
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
                      Set different lock/unlock times per door (e.g. main door open entire service, side doors locked at start).
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '14rem', overflowY: 'auto' }}>
                      {selectedDoorIds.map((dId) => {
                        const doorObj = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
                        const doorLabel = doorObj?.label || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId);
                        const isCustom = doorTimings[dId] !== undefined;
                        const dTiming = doorTimings[dId] || {};
                        const dMode = dTiming.lock_timing_mode ?? 'after_start';
                        const dUnlock = dTiming.unlock_offset_min ?? effectiveDefaultUnlock;
                        const dLock = dTiming.lock_offset_min ?? 15;

                        return (
                          <div
                            key={dId}
                            style={{
                              padding: '0.625rem 0.75rem',
                              background: 'var(--color-bg-elevated, #fff)',
                              border: `1px solid ${isCustom ? 'rgba(36, 101, 245, 0.4)' : 'var(--color-border)'}`,
                              borderRadius: 'var(--radius-sm)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.5rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.35rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>
                                  {doorLabel}
                                </span>
                                <span className={`badge ${isCustom ? 'badge-info' : 'badge-neutral'}`} style={{ fontSize: '0.625rem' }}>
                                  {isCustom ? 'Custom' : 'Default'}
                                </span>
                              </div>
                              <div>
                                {isCustom ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.6875rem', padding: '0.15rem 0.35rem' }}
                                    onClick={() => {
                                      const next = { ...doorTimings };
                                      delete next[dId];
                                      setDoorTimings(next);
                                    }}
                                  >
                                    ↩️ Reset
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ fontSize: '0.6875rem', padding: '0.15rem 0.35rem' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: {
                                          lock_timing_mode: 'after_start',
                                          lock_offset_min: 15,
                                          unlock_offset_min: effectiveDefaultUnlock,
                                        },
                                      }));
                                    }}
                                  >
                                    ⚙️ Customize
                                  </button>
                                )}
                              </div>
                            </div>

                            {isCustom && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {/* Mode Selection */}
                                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${dMode === 'after_start' ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: { ...prev[dId], lock_timing_mode: 'after_start' },
                                      }));
                                    }}
                                  >
                                    🛡️ Security (after start)
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${dMode === 'after_end' ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: { ...prev[dId], lock_timing_mode: 'after_end' },
                                      }));
                                    }}
                                  >
                                    🕒 Standard (after end)
                                  </button>
                                </div>

                                {/* Quick Presets */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Presets:</span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)', background: 'rgba(36, 101, 245, 0.08)', color: 'var(--color-accent)' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: { lock_timing_mode: 'after_end', lock_offset_min: 0, unlock_offset_min: effectiveDefaultUnlock },
                                      }));
                                    }}
                                  >
                                    🚪 Open entire service
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: { lock_timing_mode: 'after_start', lock_offset_min: 0, unlock_offset_min: 15 },
                                      }));
                                    }}
                                  >
                                    🔒 Lock at start (0m)
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)' }}
                                    onClick={() => {
                                      setDoorTimings((prev) => ({
                                        ...prev,
                                        [dId]: { lock_timing_mode: 'after_start', lock_offset_min: 15, unlock_offset_min: 15 },
                                      }));
                                    }}
                                  >
                                    🔒 Lock 15m after start
                                  </button>
                                </div>

                                {/* Sliders */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.2rem' }}>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem' }}>
                                      <span>Unlock before:</span>
                                      <strong style={{ color: 'var(--color-accent)' }}>{dUnlock}m</strong>
                                    </div>
                                    <input
                                      type="range"
                                      className="form-range"
                                      min="0"
                                      max="60"
                                      step="5"
                                      value={dUnlock}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setDoorTimings((prev) => ({
                                          ...prev,
                                          [dId]: { ...prev[dId], unlock_offset_min: val },
                                        }));
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem' }}>
                                      <span>{dMode === 'after_start' ? 'Lock after start:' : 'Lock after end:'}</span>
                                      <strong style={{ color: 'var(--color-accent)' }}>{dLock}m</strong>
                                    </div>
                                    <input
                                      type="range"
                                      className="form-range"
                                      min="0"
                                      max={dMode === 'after_start' ? '120' : '60'}
                                      step="5"
                                      value={dLock}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setDoorTimings((prev) => ({
                                          ...prev,
                                          [dId]: { ...prev[dId], lock_offset_min: val },
                                        }));
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Review & Confirm */}
            {wizardStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div
                  style={{
                    padding: '0.875rem 1rem',
                    background: 'var(--color-bg-base)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.625rem',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Mapping Summary
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.5rem', fontSize: '0.8125rem' }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Target Event:</span>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{mappingModalWindow.source_label}</div>
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Mapping Scope:</span>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {mappingMode === 'one_time' ? 'One-Time Window' : 'Recurring (All future)'}
                      </div>
                    </div>
                    {mappingMode === 'recurring' && mappingModalWindow.source_type === 'service' && (
                      <div>
                        <span style={{ color: 'var(--color-text-muted)' }}>Triggers For:</span>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>
                          {timeTypes.join(', ')}
                        </div>
                      </div>
                    )}
                    <div>
                      <span style={{ color: 'var(--color-text-muted)' }}>Baseline Rule:</span>
                      <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {effectiveDefaultMode === 'after_start'
                          ? `🛡️ Lock +${effectiveDefaultLock}m after start`
                          : `🕒 Lock +${effectiveDefaultLock}m after end`} (-{effectiveDefaultUnlock}m unlock)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Selected Doors Breakdown */}
                <div
                  style={{
                    padding: '0.875rem 1rem',
                    background: 'var(--color-bg-base)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    Doors to Unlock ({selectedDoorIds.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: '12rem', overflowY: 'auto' }}>
                    {selectedDoorIds.map((dId) => {
                      const doorObj = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
                      const doorLabel = doorObj?.label || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId);
                      const isCustom = doorTimings[dId] !== undefined;
                      const dTiming = doorTimings[dId] || {};
                      const dMode = isCustom ? dTiming.lock_timing_mode ?? 'after_start' : effectiveDefaultMode;
                      const dLock = isCustom ? dTiming.lock_offset_min ?? 15 : effectiveDefaultLock;
                      const dUnlock = isCustom ? dTiming.unlock_offset_min ?? effectiveDefaultUnlock : effectiveDefaultUnlock;

                      return (
                        <div
                          key={dId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.375rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--color-bg-elevated, #fff)',
                            fontSize: '0.8125rem',
                          }}
                        >
                          <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            🚪 {doorLabel}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: isCustom ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: isCustom ? 600 : 400 }}>
                            {dMode === 'after_start'
                              ? dLock === 0
                                ? `🔒 Locks at start (-${dUnlock}m)`
                                : `🛡️ Locks +${dLock}m after start (-${dUnlock}m)`
                              : dLock === 0
                              ? `🚪 Open entire service (-${dUnlock}m)`
                              : `🕒 Locks +${dLock}m after end (-${dUnlock}m)`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* Modal: Dismiss Event */}
      {dismissModalWindow && (
        <Modal
          isOpen={true}
          onClose={() => setDismissModalWindow(null)}
          title={`Dismiss Event: ${dismissModalWindow.source_label}`}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setDismissModalWindow(null)}
                disabled={savingDismiss}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmDismiss}
                disabled={savingDismiss}
              >
                {savingDismiss ? 'Dismissing...' : 'Confirm Dismiss'}
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: 0 }}>
              Dismissing an event removes it from the unmapped review queue. Select a reason why doors are not required:
            </p>

            <div className="form-group">
              <label className="form-label">Reason</label>
              <select
                className="form-select"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
              >
                <option value="Online Event Only">Online / Virtual Event Only</option>
                <option value="Offsite Event">Off-site / External Venue</option>
                <option value="Handled via Physical Keys / Fobs">Handled via Physical Keys / Fobs</option>
                <option value="Normal Operating Hours Cover This">Normal Operating Hours Cover This</option>
                <option value="Other">Other Reason...</option>
              </select>
            </div>

            {dismissReason === 'Other' && (
              <div className="form-group">
                <label className="form-label">Note / Custom Reason</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter custom reason..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                />
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
