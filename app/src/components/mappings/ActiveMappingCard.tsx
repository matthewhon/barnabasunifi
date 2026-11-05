'use client';

import React, { useState } from 'react';
import type {
  Door,
  Mapping,
  OrgSettings,
  PcoGroup,
  PcoServiceType,
  ScheduleWindow,
} from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { safeFormat, safeFormatDistanceToNow, parseSafeDate } from '@/lib/date-utils';
import {
  formatIsoTimeRange,
  formatIsoTimeOnly,
  formatIsoDateOnly,
  normalizePlanTimeType,
  timeTypeBadgeStyle,
} from './ProjectedUnlockTimesPreview';

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
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

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function DoorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21v-16a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" />
      <line x1="2" y1="21" x2="22" y2="21" />
      <circle cx="15.5" cy="11.5" r="1" />
    </svg>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle" style={{ cursor: disabled ? 'not-allowed' : 'pointer', margin: 0 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="toggle-track">
        <div className="toggle-thumb" />
      </div>
    </label>
  );
}

export interface ActiveMappingCardProps {
  mapping: Mapping;
  pcoResource?: PcoServiceType | PcoGroup;
  doors: Door[];
  scheduleWindows: ScheduleWindow[];
  orgSettings: OrgSettings | null;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string, label: string) => void;
  onEditMapping?: (mapping: Mapping, initialTab?: 'doors' | 'timing') => void;
  toggling: boolean;
}

export function ActiveMappingCard({
  mapping,
  pcoResource,
  doors,
  scheduleWindows,
  orgSettings,
  onToggle,
  onDelete,
  onEditMapping,
  toggling,
}: ActiveMappingCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const effectiveLockMode = mapping.lock_timing_mode ?? orgSettings?.lock_timing_mode ?? 'after_end';
  const effectiveUnlockMin = mapping.unlock_offset_min ?? orgSettings?.unlock_buffer_before_min ?? 15;
  const effectiveLockMin =
    mapping.lock_offset_min ??
    (effectiveLockMode === 'after_start'
      ? (orgSettings?.lock_after_start_min ?? 15)
      : (orgSettings?.lock_buffer_after_min ?? 15));
  const isCustomTiming =
    mapping.lock_timing_mode !== undefined ||
    mapping.lock_offset_min !== undefined ||
    mapping.unlock_offset_min !== undefined;

  const now = Date.now();
  const matchingWindows = scheduleWindows
    .filter((w) => {
      if (w.source_type !== mapping.source_type) return false;
      if (!Array.isArray(w.door_ids) || w.door_ids.length === 0) return false;

      const winMappingId = w.mapping_id || w.service_mapping_id || w.group_mapping_id;
      let isMatch = false;
      if (winMappingId) {
        isMatch = winMappingId === mapping.id;
      } else if (mapping.source_type === 'service') {
        isMatch = w.pco_service_type_id === mapping.pco_resource_id;
      } else {
        isMatch = w.pco_group_id === mapping.pco_resource_id;
      }
      if (!isMatch) return false;

      if (
        mapping.source_type === 'service' &&
        mapping.time_types &&
        mapping.time_types.length > 0 &&
        w.time_type
      ) {
        const enabledTypes = mapping.time_types.map((t) => normalizePlanTimeType(t));
        const winType = normalizePlanTimeType(w.time_type, w.time_type_name || undefined);
        if (!enabledTypes.includes(winType)) return false;
      }

      const lockTime = new Date(w.lock_at || w.ends_at).getTime();
      return !isNaN(lockTime) && lockTime >= now;
    })
    .sort((a, b) => new Date(a.unlock_at).getTime() - new Date(b.unlock_at).getTime());

  const nextWindow = matchingWindows[0];

  const frequency = (pcoResource as PcoServiceType)?.frequency;
  const schedule = (pcoResource as PcoGroup)?.schedule;
  const upcomingPlanTitle = (pcoResource as PcoServiceType)?.upcoming_plan_title;
  const upcomingTimes = pcoResource?.upcoming_times ?? [];

  const nextActivePcoTime = upcomingTimes
    .filter((t) => {
      if (mapping.source_type === 'service' && mapping.time_types && mapping.time_types.length > 0) {
        const enabledTypes = mapping.time_types.map((tt) => normalizePlanTimeType(tt));
        const normType = normalizePlanTimeType(t.time_type, t.name);
        if (!enabledTypes.includes(normType)) return false;
      }
      const endMs = parseSafeDate(t.ends_at || t.starts_at)?.getTime() ?? 0;
      return endMs + 2 * 60 * 60 * 1000 >= now;
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];

  const refStartDate = parseSafeDate(nextWindow?.starts_at || nextActivePcoTime?.starts_at);
  const refEndDate =
    parseSafeDate(nextWindow?.ends_at || nextActivePcoTime?.ends_at) ||
    (refStartDate ? new Date(refStartDate.getTime() + 60 * 60 * 1000) : null);

  const mappedDoors = mapping.door_ids.map((dId, idx) => {
    const found = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
    const cleanLabel = (found?.label || mapping.door_labels?.[idx] || '').trim();
    const timingOverride = mapping.door_timings?.[dId];
    const isDoorCustom = Boolean(
      timingOverride &&
        (timingOverride.lock_timing_mode !== undefined ||
          timingOverride.lock_offset_min !== undefined ||
          timingOverride.unlock_offset_min !== undefined)
    );
    const doorLockMode = timingOverride?.lock_timing_mode ?? effectiveLockMode;
    const doorUnlockMin = timingOverride?.unlock_offset_min ?? effectiveUnlockMin;
    const doorLockMin =
      timingOverride?.lock_offset_min ??
      (doorLockMode === effectiveLockMode
        ? effectiveLockMin
        : doorLockMode === 'after_start'
        ? (orgSettings?.lock_after_start_min ?? 15)
        : (orgSettings?.lock_buffer_after_min ?? 15));

    let nextUnlockIso = nextWindow?.door_timings?.[dId]?.unlock_at || '';
    let nextLockIso = nextWindow?.door_timings?.[dId]?.lock_at || '';

    if (refStartDate && refEndDate) {
      const calcUnlock = new Date(refStartDate.getTime() - doorUnlockMin * 60 * 1000);
      const calcLock =
        doorLockMode === 'after_start'
          ? new Date(refStartDate.getTime() + doorLockMin * 60 * 1000)
          : new Date(refEndDate.getTime() + doorLockMin * 60 * 1000);
      nextUnlockIso = calcUnlock.toISOString();
      nextLockIso = calcLock.toISOString();
    } else if (nextWindow && (!nextUnlockIso || !nextLockIso)) {
      nextUnlockIso = nextWindow.unlock_at;
      nextLockIso = nextWindow.lock_at;
    }

    return {
      id: dId,
      label: cleanLabel || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId),
      state: found?.current_state ?? 'unknown',
      isHeld: found?.is_held_unlocked ?? false,
      campusName: found?.campus_name,
      locationName: found?.location_name,
      isHidden: isDoorHidden(found),
      isDoorCustom,
      doorLockMode,
      doorUnlockMin,
      doorLockMin,
      nextUnlockIso,
      nextLockIso,
      nextUnlockTime: nextUnlockIso ? formatIsoTimeOnly(nextUnlockIso) : '',
      nextLockTime: nextLockIso ? formatIsoTimeOnly(nextLockIso) : '',
    };
  });

  const customDoorsCount = mappedDoors.filter((d) => d.isDoorCustom).length;

  const windowEarliestUnlockIso = (() => {
    const validMs = mappedDoors
      .map((d) => (d.nextUnlockIso ? new Date(d.nextUnlockIso).getTime() : NaN))
      .filter((ms) => !isNaN(ms));
    if (validMs.length > 0) return new Date(Math.min(...validMs)).toISOString();
    return nextWindow?.unlock_at || '';
  })();

  const windowLatestLockIso = (() => {
    const validMs = mappedDoors
      .map((d) => (d.nextLockIso ? new Date(d.nextLockIso).getTime() : NaN))
      .filter((ms) => !isNaN(ms));
    if (validMs.length > 0) return new Date(Math.max(...validMs)).toISOString();
    return nextWindow?.lock_at || '';
  })();

  const isWindowCurrentlyActive =
    nextWindow && new Date(windowEarliestUnlockIso || nextWindow.unlock_at).getTime() <= now;

  return (
    <div
      className="card"
      style={{
        padding: '1.125rem 1.25rem',
        marginBottom: '0.875rem',
        border: `1px solid ${isWindowCurrentlyActive ? 'rgba(16, 185, 129, 0.4)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        opacity: mapping.enabled ? 1 : 0.72,
        transition: 'all 0.15s ease',
      }}
    >
      {/* 1. Compact Header: Title, Badges, Trigger Time Types, Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1, minWidth: '14rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1.025rem', color: 'var(--color-text-primary)' }}>
              {mapping.pco_resource_label}
            </span>
            <span
              className={`badge ${mapping.source_type === 'service' ? 'badge-info' : 'badge-neutral'}`}
              style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}
            >
              {mapping.source_type === 'service' ? '⛪ Service' : '👥 Group'}
            </span>
            {(frequency || schedule) && (
              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', fontWeight: 500 }}>
                {frequency || schedule}
              </span>
            )}
            {mapping.source_type === 'service' && mapping.time_types && mapping.time_types.length > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                · Triggers on:{' '}
                <strong style={{ color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>
                  {mapping.time_types.join(', ')}
                </strong>
              </span>
            )}
          </div>

          {/* Timing rule summary line */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
            <span>
              {effectiveLockMode === 'after_start' ? (
                <>
                  <strong style={{ color: 'var(--color-success, #10b981)' }}>🛡️ Security Mode:</strong> Unlocks{' '}
                  <strong>-{effectiveUnlockMin}m</strong> before · Locks <strong>+{effectiveLockMin}m</strong> after start
                </>
              ) : (
                <>
                  <strong>🕒 Standard Mode:</strong> Unlocks <strong>-{effectiveUnlockMin}m</strong> before · Locks{' '}
                  <strong>+{effectiveLockMin}m</strong> after end
                </>
              )}
            </span>
            {isCustomTiming && (
              <span className="badge badge-info" style={{ fontSize: '0.625rem', padding: '0.05rem 0.35rem' }}>
                Custom Default
              </span>
            )}
            {customDoorsCount > 0 && (
              <span
                className="badge"
                style={{
                  fontSize: '0.625rem',
                  padding: '0.05rem 0.35rem',
                  background: 'rgba(168, 85, 247, 0.12)',
                  color: '#9333ea',
                  border: '1px solid rgba(168, 85, 247, 0.25)',
                }}
              >
                {customDoorsCount} Door Override{customDoorsCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {onEditMapping && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              onClick={() => onEditMapping(mapping, 'doors')}
              title="Edit doors, trigger time types, or lock/unlock timing rules"
            >
              <EditIcon />
              <span>Edit Rule</span>
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', paddingInline: '0.25rem' }} title={mapping.enabled ? 'Mapping enabled' : 'Mapping disabled'}>
            <Toggle checked={mapping.enabled} onChange={(v) => onToggle(mapping.id, v)} disabled={toggling} />
          </div>

          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--color-danger, #ef4444)', padding: '0.35rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => onDelete(mapping.id, mapping.pco_resource_label)}
            title="Delete mapping"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* 2. Core Visual: Mapped Doors & Next Scheduled Window */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
          gap: '0.75rem',
          alignItems: 'stretch',
        }}
      >
        {/* Left Box: Mapped UniFi Doors */}
        <div
          style={{
            padding: '0.75rem 0.875rem',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <DoorIcon />
              Mapped Doors ({mappedDoors.length})
            </span>
            {onEditMapping && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.6875rem', padding: '0.1rem 0.35rem', height: 'auto', color: 'var(--color-accent)' }}
                onClick={() => onEditMapping(mapping, 'doors')}
              >
                + / - Doors
              </button>
            )}
          </div>

          {mappedDoors.length === 0 ? (
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No doors assigned</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {mappedDoors.map((door) => {
                const isUnlocked = door.state === 'unlocked' || door.isHeld;
                const isLocked = door.state === 'locked';

                return (
                  <div
                    key={door.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      padding: '0.3rem 0.55rem',
                      background: 'var(--color-bg-surface)',
                      border: `1px solid ${door.isDoorCustom ? 'rgba(36, 101, 245, 0.35)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                    }}
                    title={
                      door.isDoorCustom
                        ? `Custom Override: Unlocks -${door.doorUnlockMin}m before, Locks +${door.doorLockMin}m after ${door.doorLockMode === 'after_start' ? 'start' : 'end'}`
                        : `Default Rule: Unlocks -${door.doorUnlockMin}m before, Locks +${door.doorLockMin}m after ${door.doorLockMode === 'after_start' ? 'start' : 'end'}`
                    }
                  >
                    <span title={isUnlocked ? 'Unlocked' : isLocked ? 'Locked' : 'Unknown state'}>
                      {isUnlocked ? '🔓' : isLocked ? '🔒' : '🚪'}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{door.label}</span>
                    {door.campusName && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                        ({door.campusName})
                      </span>
                    )}
                    {door.isDoorCustom && (
                      <span
                        className="badge badge-info"
                        style={{ fontSize: '0.6rem', padding: '0.02rem 0.25rem' }}
                      >
                        {door.doorLockMode === 'after_start' ? `+${door.doorLockMin}m start` : `+${door.doorLockMin}m end`}
                      </span>
                    )}
                    {door.isHidden && (
                      <span className="badge badge-danger" style={{ fontSize: '0.6rem', padding: '0.02rem 0.25rem' }}>
                        Hidden
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Box: Next Scheduled Unlock Window */}
        <div
          style={{
            padding: '0.75rem 0.875rem',
            borderRadius: 'var(--radius-md)',
            background: isWindowCurrentlyActive
              ? 'rgba(16, 185, 129, 0.08)'
              : nextWindow || refStartDate
              ? 'rgba(36, 101, 245, 0.05)'
              : 'var(--color-bg-elevated)',
            border: `1px solid ${
              isWindowCurrentlyActive
                ? 'rgba(16, 185, 129, 0.3)'
                : nextWindow || refStartDate
                ? 'rgba(36, 101, 245, 0.2)'
                : 'var(--color-border)'
            }`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.35rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: isWindowCurrentlyActive
                  ? 'var(--color-success, #10b981)'
                  : nextWindow || refStartDate
                  ? 'var(--color-accent)'
                  : 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {isWindowCurrentlyActive ? '🟢 Active Now' : '📅 Next Scheduled Unlock'}
            </span>
            {nextWindow && (
              <span
                className={`badge ${
                  nextWindow.status === 'unlocked'
                    ? 'badge-success'
                    : nextWindow.status === 'pending'
                    ? 'badge-info'
                    : 'badge-neutral'
                }`}
                style={{ fontSize: '0.625rem', textTransform: 'capitalize' }}
              >
                {nextWindow.status}
              </span>
            )}
          </div>

          {nextWindow || refStartDate ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {formatIsoDateOnly(
                  nextWindow?.starts_at ||
                    nextActivePcoTime?.starts_at ||
                    windowEarliestUnlockIso ||
                    nextWindow?.unlock_at ||
                    ''
                )}
                {upcomingPlanTitle ? ` · ${upcomingPlanTitle}` : ''}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                {windowEarliestUnlockIso && windowLatestLockIso ? (
                  <>
                    <span style={{ color: 'var(--color-success, #10b981)', fontWeight: 600 }}>
                      🔓 Unlock {formatIsoTimeOnly(windowEarliestUnlockIso)}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                    <span style={{ color: effectiveLockMode === 'after_start' ? 'var(--color-accent)' : '#d97706', fontWeight: 600 }}>
                      🔒 Lock {formatIsoTimeOnly(windowLatestLockIso)}
                    </span>
                  </>
                ) : null}
                {refStartDate && refEndDate && (
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>
                    (Event: {safeFormat(refStartDate, 'h:mm a')} – {safeFormat(refEndDate, 'h:mm a')})
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              No upcoming times currently published in Planning Center.
            </div>
          )}
        </div>
      </div>

      {/* 3. Expandable Details Drawer Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--color-border)',
          paddingTop: '0.5rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setDetailsOpen((o) => !o)}
          style={{
            fontSize: '0.75rem',
            padding: '0.15rem 0.4rem',
            height: 'auto',
            color: 'var(--color-text-secondary)',
            fontWeight: 500,
          }}
        >
          {detailsOpen ? '▴ Hide' : '▾ View'} per-door schedule &amp; {upcomingTimes.length} pulled PCO time{upcomingTimes.length === 1 ? '' : 's'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.6875rem' }}>
          {onEditMapping && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.6875rem', padding: '0.1rem 0.35rem', height: 'auto' }}
              onClick={() => onEditMapping(mapping, 'timing')}
            >
              ⚙️ Per-Door Timing Rules
            </button>
          )}
          <span>
            Updated {mapping.updated_at ? safeFormatDistanceToNow(mapping.updated_at) : '—'}
          </span>
        </div>
      </div>

      {/* Expandable Drawer Content */}
      {detailsOpen && (
        <div
          style={{
            padding: '0.875rem',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.875rem',
          }}
        >
          {/* Per-Door Schedule Breakdown */}
          {mappedDoors.length > 0 && (
            <div>
              <div style={{ fontSize: '0.725rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                Per-Door Unlock &amp; Lock Schedule
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.4rem' }}>
                {mappedDoors.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      padding: '0.4rem 0.65rem',
                      background: 'var(--color-bg-surface)',
                      border: `1px solid ${d.isDoorCustom ? 'rgba(36, 101, 245, 0.35)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>🚪 {d.label}</span>
                      {d.isDoorCustom && (
                        <span className="badge badge-info" style={{ fontSize: '0.6rem', padding: '0.02rem 0.25rem' }}>
                          Custom
                        </span>
                      )}
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        (-{d.doorUnlockMin}m / +{d.doorLockMin}m {d.doorLockMode === 'after_start' ? 'start' : 'end'})
                      </span>
                    </div>
                    {d.nextUnlockTime && d.nextLockTime && (
                      <div style={{ fontWeight: 600, fontSize: '0.725rem', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--color-success, #10b981)' }}>{d.nextUnlockTime}</span>
                        {' → '}
                        <span style={{ color: d.doorLockMode === 'after_start' ? 'var(--color-accent)' : '#d97706' }}>
                          {d.nextLockTime}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pulled PCO Times */}
          <div>
            <div style={{ fontSize: '0.725rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
              Upcoming Pulled Planning Center Times ({upcomingTimes.length})
            </div>
            {upcomingTimes.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                No upcoming times found in Planning Center.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                {upcomingTimes.map((t) => {
                  const normType = normalizePlanTimeType(t.time_type, t.name);
                  const isEnabled =
                    !mapping.time_types ||
                    mapping.time_types.length === 0 ||
                    mapping.time_types.map((tt) => normalizePlanTimeType(tt)).includes(normType);
                  const style = isEnabled
                    ? timeTypeBadgeStyle(normType)
                    : { bg: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: 'var(--color-border)' };
                  const timeLabel = formatIsoTimeRange(t.starts_at, t.ends_at);

                  return (
                    <span
                      key={t.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        background: style.bg,
                        color: style.color,
                        border: `1px ${isEnabled ? 'solid' : 'dashed'} ${style.border}`,
                        fontSize: '0.725rem',
                        fontWeight: isEnabled ? 600 : 400,
                        opacity: isEnabled ? 1 : 0.65,
                      }}
                    >
                      <ClockIcon />
                      <span>{timeLabel}</span>
                      <span style={{ opacity: 0.85, textTransform: 'capitalize', fontSize: '0.675rem' }}>
                        ({t.name ? `${t.name} · ` : ''}
                        {normType}
                        {!isEnabled ? ' — Excluded' : ''})
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
