'use client';

import React from 'react';
import { safeFormat, parseSafeDate } from '@/lib/date-utils';
import type {
  Door,
  DoorTimingConfig,
  OrgSettings,
  PcoGroup,
  PcoServiceType,
  PlanTimeType,
} from '@/lib/types';

export function formatIsoTimeRange(startsAtStr: string, endsAtStr?: string): string {
  const startDate = parseSafeDate(startsAtStr);
  if (!startDate) return '—';

  const startFormatted = safeFormat(startDate, 'h:mm a');
  const dateFormatted = safeFormat(startDate, 'EEE, MMM d');

  if (!endsAtStr) {
    return `${dateFormatted} · ${startFormatted}`;
  }

  const endDate = parseSafeDate(endsAtStr);
  if (!endDate) {
    return `${dateFormatted} · ${startFormatted}`;
  }

  const endFormatted = safeFormat(endDate, 'h:mm a');
  return `${dateFormatted} · ${startFormatted} – ${endFormatted}`;
}

export function formatIsoTimeOnly(isoStr: string): string {
  const d = parseSafeDate(isoStr);
  return d ? safeFormat(d, 'h:mm a') : '';
}

export function formatIsoDateOnly(isoStr: string): string {
  const d = parseSafeDate(isoStr);
  return d ? safeFormat(d, 'EEE, MMM d, yyyy') : '';
}

export function normalizePlanTimeType(rawType: unknown, name?: string): 'service' | 'rehearsal' | 'other' {
  if (rawType !== undefined && rawType !== null) {
    const s = String(rawType).toLowerCase().trim();
    if (s === '0' || s === 'service' || s === 'service_time' || s.includes('service')) return 'service';
    if (
      s === '1' ||
      s === 'rehearsal' ||
      s === 'rehearsal_time' ||
      s.includes('rehearsal') ||
      s.includes('practice') ||
      s.includes('sound check') ||
      s.includes('soundcheck') ||
      s.includes('warmup') ||
      s.includes('warm-up')
    ) {
      return 'rehearsal';
    }
    if (s === '2' || s === 'other' || s === 'other_time' || s.includes('other')) return 'other';
  }
  if (name) {
    const s = name.toLowerCase().trim();
    if (
      s.includes('rehearsal') ||
      s.includes('practice') ||
      s.includes('sound check') ||
      s.includes('soundcheck') ||
      s.includes('warmup') ||
      s.includes('warm-up')
    ) {
      return 'rehearsal';
    }
    if (s.includes('service') || s.includes('worship')) return 'service';
  }
  return 'service';
}

export function timeTypeBadgeStyle(timeType?: string): { bg: string; color: string; border: string } {
  const t = (timeType || '').toLowerCase();
  if (t === 'service') {
    return {
      bg: 'rgba(36, 101, 245, 0.12)',
      color: 'var(--color-accent, #2465f5)',
      border: 'rgba(36, 101, 245, 0.25)',
    };
  }
  if (t === 'rehearsal') {
    return {
      bg: 'rgba(234, 179, 8, 0.12)',
      color: '#ca8a04',
      border: 'rgba(234, 179, 8, 0.25)',
    };
  }
  if (t === 'event') {
    return {
      bg: 'rgba(168, 85, 247, 0.12)',
      color: '#9333ea',
      border: 'rgba(168, 85, 247, 0.25)',
    };
  }
  return {
    bg: 'var(--color-bg-elevated)',
    color: 'var(--color-text-secondary)',
    border: 'var(--color-border)',
  };
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export interface ProjectedUnlockTimesPreviewProps {
  sourceType: 'service' | 'group';
  selectedResource?: PcoServiceType | PcoGroup | null;
  timeTypes?: PlanTimeType[];
  selectedDoorIds: string[];
  doors: Door[];
  timingChoice: 'default' | 'after_start' | 'after_end';
  customUnlockMin: number;
  customLockMin: number;
  doorTimings: Record<string, DoorTimingConfig>;
  orgSettings: OrgSettings | null;
}

export function ProjectedUnlockTimesPreview({
  sourceType,
  selectedResource,
  timeTypes,
  selectedDoorIds,
  doors,
  timingChoice,
  customUnlockMin,
  customLockMin,
  doorTimings,
  orgSettings,
}: ProjectedUnlockTimesPreviewProps) {
  const orgMode = orgSettings?.lock_timing_mode ?? 'after_end';
  const orgUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
  const orgLockAfterStart = orgSettings?.lock_after_start_min ?? 15;
  const orgLockAfterEnd = orgSettings?.lock_buffer_after_min ?? 15;
  const orgLock = orgMode === 'after_start' ? orgLockAfterStart : orgLockAfterEnd;

  const effectiveDefaultMode = timingChoice !== 'default' ? timingChoice : orgMode;
  const effectiveDefaultUnlock = timingChoice !== 'default' ? customUnlockMin : orgUnlock;
  const effectiveDefaultLock = timingChoice !== 'default' ? customLockMin : orgLock;

  const rawUpcomingTimes = selectedResource?.upcoming_times || [];
  const filteredUpcomingTimes = rawUpcomingTimes
    .filter((t) => {
      if (sourceType !== 'service') return true;
      if (!timeTypes || timeTypes.length === 0) return true;
      const norm = normalizePlanTimeType(t.time_type, t.name);
      return timeTypes.includes(norm);
    })
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const displayTimes = filteredUpcomingTimes.slice(0, 3);
  const remainingCount = filteredUpcomingTimes.length - displayTimes.length;

  const computeSchedule = (startsAtStr: string, endsAtStr?: string) => {
    const start = parseSafeDate(startsAtStr);
    if (!start) return null;
    const end = endsAtStr ? parseSafeDate(endsAtStr) : new Date(start.getTime() + 60 * 60 * 1000);
    const effectiveEnd = end || new Date(start.getTime() + 60 * 60 * 1000);

    const baseUnlock = new Date(start.getTime() - effectiveDefaultUnlock * 60 * 1000);
    const baseLock =
      effectiveDefaultMode === 'after_start'
        ? new Date(start.getTime() + effectiveDefaultLock * 60 * 1000)
        : new Date(effectiveEnd.getTime() + effectiveDefaultLock * 60 * 1000);

    const doorBreakdown = selectedDoorIds.map((dId) => {
      const doorObj = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
      const label = doorObj?.label || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId);
      const override = doorTimings[dId];
      const isCustom = Boolean(override);

      const dUnlockOffset = override?.unlock_offset_min ?? effectiveDefaultUnlock;
      const dLockMode = override?.lock_timing_mode ?? effectiveDefaultMode;
      const dLockOffset =
        override?.lock_offset_min ??
        (dLockMode === 'after_start'
          ? effectiveDefaultMode === 'after_start'
            ? effectiveDefaultLock
            : orgLockAfterStart
          : effectiveDefaultMode === 'after_end'
          ? effectiveDefaultLock
          : orgLockAfterEnd);

      const dUnlock = new Date(start.getTime() - dUnlockOffset * 60 * 1000);
      const dLock =
        dLockMode === 'after_start'
          ? new Date(start.getTime() + dLockOffset * 60 * 1000)
          : new Date(effectiveEnd.getTime() + dLockOffset * 60 * 1000);

      return {
        doorId: dId,
        label,
        isCustom,
        unlockTime: safeFormat(dUnlock, 'h:mm a'),
        lockTime: safeFormat(dLock, 'h:mm a'),
        unlockOffset: dUnlockOffset,
        lockOffset: dLockOffset,
        lockMode: dLockMode,
      };
    });

    const baselineDoors = doorBreakdown.filter((d) => !d.isCustom);
    const customDoors = doorBreakdown.filter((d) => d.isCustom);

    return {
      start,
      end: effectiveEnd,
      startDateFormatted: safeFormat(start, 'EEE, MMM d, yyyy'),
      startTimeFormatted: safeFormat(start, 'h:mm a'),
      endTimeFormatted: safeFormat(effectiveEnd, 'h:mm a'),
      baseUnlockTime: safeFormat(baseUnlock, 'h:mm a'),
      baseLockTime: safeFormat(baseLock, 'h:mm a'),
      baselineDoors,
      customDoors,
    };
  };

  // Sample fallback projection for when no dates are in PCO yet
  const sampleSchedule = (() => {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + ((7 - nextDate.getDay()) % 7 || 7));
    nextDate.setHours(10, 0, 0, 0);
    const nextEndDate = new Date(nextDate.getTime() + 90 * 60 * 1000);
    return computeSchedule(nextDate.toISOString(), nextEndDate.toISOString());
  })();

  return (
    <div
      style={{
        padding: '0.875rem 1rem',
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
          <ClockIcon />
          <span>Projected Door Unlock &amp; Lock Schedule</span>
        </div>
        <span className="badge badge-info" style={{ fontSize: '0.6875rem', padding: '0.1rem 0.4rem' }}>
          {displayTimes.length > 0 ? 'Live PCO Schedule' : 'Example Projection'}
        </span>
      </div>

      {displayTimes.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {displayTimes.map((t) => {
            const sched = computeSchedule(t.starts_at, t.ends_at);
            if (!sched) return null;
            const normType = normalizePlanTimeType(t.time_type, t.name);
            const style = timeTypeBadgeStyle(normType);

            return (
              <div
                key={t.id}
                style={{
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.375rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>
                      📅 {sched.startDateFormatted}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      · {t.name ? `${t.name}: ` : ''}{sched.startTimeFormatted} – {sched.endTimeFormatted}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '0.1rem 0.35rem',
                      borderRadius: 'var(--radius-sm, 4px)',
                      background: style.bg,
                      color: style.color,
                      border: `1px solid ${style.border}`,
                      textTransform: 'capitalize',
                    }}
                  >
                    {normType}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.5rem' }}>
                  <div
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.125rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-success, #10b981)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        🔓 Unlocks At
                      </span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        -{effectiveDefaultUnlock}m before
                      </span>
                    </div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {sched.baseUnlockTime}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: effectiveDefaultMode === 'after_start' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.08)',
                      border: `1px solid ${effectiveDefaultMode === 'after_start' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.25)'}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.125rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: effectiveDefaultMode === 'after_start' ? 'var(--color-accent)' : '#d97706', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        🔒 Locks At
                      </span>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        {effectiveDefaultMode === 'after_start' ? `+${effectiveDefaultLock}m after start` : `+${effectiveDefaultLock}m after end`}
                      </span>
                    </div>
                    <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {sched.baseLockTime}
                    </div>
                  </div>
                </div>

                {sched.customDoors.length > 0 ? (
                  <div style={{ marginTop: '0.25rem', paddingTop: '0.375rem', borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {sched.baselineDoors.length > 0 && (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)' }}>
                        <span style={{ fontWeight: 600 }}>Baseline Doors ({sched.baselineDoors.length}):</span>{' '}
                        {sched.baselineDoors.map((d) => d.label).join(', ')} ({sched.baseUnlockTime} → {sched.baseLockTime})
                      </div>
                    )}
                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      Custom Door Overrides:
                    </div>
                    {sched.customDoors.map((cd) => (
                      <div key={cd.doorId} style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>• {cd.label}:</span>
                        <span style={{ color: 'var(--color-success, #10b981)', fontWeight: 600 }}>🔓 {cd.unlockTime}</span>
                        <span>→</span>
                        <span style={{ color: cd.lockMode === 'after_start' ? 'var(--color-accent)' : '#d97706', fontWeight: 600 }}>🔒 {cd.lockTime}</span>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                          ({cd.lockMode === 'after_start' ? `Security: +${cd.lockOffset}m start` : `Standard: +${cd.lockOffset}m end`})
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                    Applies to all selected doors: {sched.baselineDoors.map((d) => d.label).join(', ')}
                  </div>
                )}
              </div>
            );
          })}

          {remainingCount > 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
              + {remainingCount} more upcoming Planning Center time{remainingCount === 1 ? '' : 's'} will follow these rules.
            </div>
          )}
        </div>
      ) : sampleSchedule ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div
            style={{
              padding: '0.625rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(36, 101, 245, 0.06)',
              border: '1px solid rgba(36, 101, 245, 0.2)',
              fontSize: '0.75rem',
              color: 'var(--color-text-secondary)',
            }}
          >
            No upcoming plan times are currently published in Planning Center for this resource. Example based on a <strong>10:00 AM – 11:30 AM</strong> event:
          </div>

          <div
            style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.5rem' }}>
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.125rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-success, #10b981)', textTransform: 'uppercase' }}>
                    🔓 Unlocks At
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                    -{effectiveDefaultUnlock}m before
                  </span>
                </div>
                <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {sampleSchedule.baseUnlockTime}
                </div>
              </div>

              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  background: effectiveDefaultMode === 'after_start' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.08)',
                  border: `1px solid ${effectiveDefaultMode === 'after_start' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.25)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.125rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: effectiveDefaultMode === 'after_start' ? 'var(--color-accent)' : '#d97706', textTransform: 'uppercase' }}>
                    🔒 Locks At
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                    {effectiveDefaultMode === 'after_start' ? `+${effectiveDefaultLock}m after start` : `+${effectiveDefaultLock}m after end`}
                  </span>
                </div>
                <div style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {sampleSchedule.baseLockTime}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
