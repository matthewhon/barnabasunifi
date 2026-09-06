'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  getMappings,
  createMapping,
  updateMapping,
  deleteMapping,
  subscribeToDoors,
  subscribeToScheduleWindows,
  getOrgSettings,
} from '@/lib/firestore';
import type {
  Mapping,
  Door,
  MappingSourceType,
  PlanTimeType,
  LockTimingMode,
  PcoServiceType,
  PcoGroup,
  PcoTimeInfo,
  ScheduleWindow,
  OrgSettings,
} from '@/lib/types';
import Modal from '@/components/ui/Modal';
import { safeFormat, safeFormatDistanceToNow, parseSafeDate } from '@/lib/date-utils';

// ─── Icons ────────────────────────────────────────────────────────────────────

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

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
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

function TagIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatIsoTimeRange(startsAtStr: string, endsAtStr?: string): string {
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

function formatIsoTimeOnly(isoStr: string): string {
  const d = parseSafeDate(isoStr);
  return d ? safeFormat(d, 'h:mm a') : '';
}

function timeTypeBadgeStyle(timeType?: string): { bg: string; color: string; border: string } {
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

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
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

// ─── Active Mapping Card ──────────────────────────────────────────────────────

interface ActiveMappingCardProps {
  mapping: Mapping;
  pcoResource?: PcoServiceType | PcoGroup;
  doors: Door[];
  scheduleWindows: ScheduleWindow[];
  orgSettings: OrgSettings | null;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string, label: string) => void;
  onEditTiming?: (mapping: Mapping) => void;
  toggling: boolean;
}

function ActiveMappingCard({
  mapping,
  pcoResource,
  doors,
  scheduleWindows,
  orgSettings,
  onToggle,
  onDelete,
  onEditTiming,
  toggling,
}: ActiveMappingCardProps) {
  // Find doors matching this mapping
  const mappedDoors = mapping.door_ids.map((dId) => {
    const found = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
    return {
      id: dId,
      label: found?.label ?? dId,
      state: found?.current_state ?? 'unknown',
      isHeld: found?.is_held_unlocked ?? false,
      position: found?.door_position_status,
    };
  });

  // Find upcoming schedule windows linked to this mapping / service / group
  const matchingWindows = scheduleWindows
    .filter((w) => {
      if (w.source_type !== mapping.source_type) return false;
      if (w.source_label && w.source_label.toLowerCase().includes(mapping.pco_resource_label.toLowerCase())) return true;
      if ((w as any).pco_service_type_id === mapping.pco_resource_id) return true;
      if ((w as any).service_mapping_id === mapping.id) return true;
      return false;
    })
    .sort((a, b) => new Date(a.unlock_at).getTime() - new Date(b.unlock_at).getTime());

  const nextWindow = matchingWindows[0];

  const effectiveLockMode = mapping.lock_timing_mode ?? orgSettings?.lock_timing_mode ?? 'after_end';
  const effectiveUnlockMin = mapping.unlock_offset_min ?? orgSettings?.unlock_buffer_before_min ?? 15;
  const effectiveLockMin = mapping.lock_offset_min ?? (effectiveLockMode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15));
  const isCustomTiming = mapping.lock_timing_mode !== undefined || mapping.lock_offset_min !== undefined || mapping.unlock_offset_min !== undefined;

  const frequency = (pcoResource as PcoServiceType)?.frequency;
  const schedule = (pcoResource as PcoGroup)?.schedule;
  const upcomingPlanTitle = (pcoResource as PcoServiceType)?.upcoming_plan_title;
  const upcomingTimes = pcoResource?.upcoming_times ?? [];

  return (
    <div
      className="card"
      style={{
        padding: '1.25rem',
        marginBottom: '1rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))',
      }}
    >
      {/* 1. Header: Name, Types, Toggle & Delete */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '12rem', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-text-primary)' }}>
              {mapping.pco_resource_label}
            </span>
            <span
              className={`badge ${mapping.source_type === 'service' ? 'badge-info' : 'badge-neutral'}`}
              style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}
            >
              {mapping.source_type}
            </span>
            <span
              className={`badge ${mapping.enabled ? 'badge-success' : 'badge-neutral'}`}
              style={{ fontSize: '0.6875rem' }}
            >
              {mapping.enabled ? 'Active' : 'Disabled'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', flexWrap: 'wrap', marginTop: '0.125rem' }}>
            <span>Resource ID: <code style={{ fontSize: '0.75rem' }}>{mapping.pco_resource_id}</code></span>
            <span>•</span>
            <span>Mapping ID: <code style={{ fontSize: '0.75rem' }}>{mapping.id.slice(0, 8)}…</code></span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
              {mapping.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Toggle
              checked={mapping.enabled}
              onChange={(v) => onToggle(mapping.id, v)}
              disabled={toggling}
            />
          </div>

          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--color-danger, #ef4444)', padding: '0.4rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => onDelete(mapping.id, mapping.pco_resource_label)}
            title="Delete mapping"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* 2. Timing & Schedule Details */}
      <div
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '0.875rem 1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.625rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            <CalendarIcon />
            <span>Planning Center Schedule & Times</span>
          </div>

          {(frequency || schedule) && (
            <span className="badge badge-neutral" style={{ fontSize: '0.75rem', fontWeight: 500 }}>
              {frequency ? `Frequency: ${frequency}` : `Schedule: ${schedule}`}
            </span>
          )}
        </div>

        {upcomingPlanTitle && (
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ fontWeight: 600 }}>Next Plan:</span>
            <span>{upcomingPlanTitle}</span>
          </div>
        )}

        {upcomingTimes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Upcoming Pulled Times ({upcomingTimes.length})
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
              {upcomingTimes
                .slice()
                .sort((a, b) => {
                  const aEnabled = !mapping.time_types || mapping.time_types.length === 0 ||
                    mapping.time_types.map((tt) => tt.toLowerCase()).includes((a.time_type || 'service').toLowerCase());
                  const bEnabled = !mapping.time_types || mapping.time_types.length === 0 ||
                    mapping.time_types.map((tt) => tt.toLowerCase()).includes((b.time_type || 'service').toLowerCase());
                  if (aEnabled && !bEnabled) return -1;
                  if (!aEnabled && bEnabled) return 1;
                  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
                })
                .map((t) => {
                  const isEnabled = !mapping.time_types || mapping.time_types.length === 0 ||
                    mapping.time_types.map((tt) => tt.toLowerCase()).includes((t.time_type || 'service').toLowerCase());
                  const style = isEnabled ? timeTypeBadgeStyle(t.time_type) : { bg: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: 'var(--color-border)' };
                  const timeLabel = formatIsoTimeRange(t.starts_at, t.ends_at);

                  return (
                    <span
                      key={t.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        padding: '0.25rem 0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        background: style.bg,
                        color: style.color,
                        border: `1px ${isEnabled ? 'solid' : 'dashed'} ${style.border}`,
                        fontSize: '0.75rem',
                        fontWeight: isEnabled ? 600 : 400,
                        opacity: isEnabled ? 1 : 0.65,
                      }}
                      title={isEnabled ? 'Active trigger time for this mapping' : `Excluded from unlocking (mapping only triggers on: ${(mapping.time_types || []).join(', ')})`}
                    >
                      <ClockIcon />
                      <span>{timeLabel}</span>
                      <span style={{ opacity: 0.85, textTransform: 'capitalize', fontSize: '0.6875rem' }}>
                        ({t.name ? `${t.name} · ` : ''}{t.time_type || 'service'}{!isEnabled ? ' — Excluded' : ' — Active'})
                      </span>
                    </span>
                  );
                })}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No upcoming plan or event times currently published in Planning Center.
          </div>
        )}
      </div>

      {/* 3. Mapped UniFi Doors & Live Status */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            <DoorIcon />
            <span>Mapped UniFi Doors ({mappedDoors.length})</span>
          </div>
        </div>

        {mappedDoors.length === 0 ? (
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            No doors assigned to this mapping.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {mappedDoors.map((door) => {
              const isUnlocked = door.state === 'unlocked' || door.isHeld;
              const isLocked = door.state === 'locked';

              return (
                <div
                  key={door.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.375rem 0.625rem',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {door.label}
                  </span>
                  <span
                    className={`badge ${
                      isUnlocked ? 'badge-success' : isLocked ? 'badge-danger' : 'badge-neutral'
                    }`}
                    style={{ fontSize: '0.6875rem' }}
                  >
                    {door.isHeld ? 'Held Open' : door.state}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Trigger Configuration & Buffer Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        {/* Time types trigger */}
        <div
          style={{
            padding: '0.625rem 0.75rem',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
            Trigger Time Types
          </div>
          {mapping.source_type === 'service' ? (
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {mapping.time_types && mapping.time_types.length > 0 ? (
                mapping.time_types.map((tt) => (
                  <span key={tt} className="badge badge-info" style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}>
                    {tt}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>None selected</span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-primary)', fontWeight: 500 }}>
              All Group Events
            </span>
          )}
        </div>

        {/* Buffers & Lock Rule applied */}
        <div
          style={{
            padding: '0.625rem 0.75rem',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
              Door Locking Rule {isCustomTiming && <span className="badge badge-info" style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem' }}>Custom</span>}
            </div>
            {onEditTiming && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem', height: 'auto' }}
                onClick={() => onEditTiming(mapping)}
                title="Edit lock timing rule for this mapping"
              >
                ⚙️ Edit Rule
              </button>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
            {effectiveLockMode === 'after_start' ? (
              <>
                <span style={{ color: 'var(--color-success, #10b981)', fontWeight: 600 }}>🛡️ Security Mode:</span> Locks <strong style={{ color: 'var(--color-accent)' }}>+{effectiveLockMin}m</strong> after start · Unlocks <strong style={{ color: 'var(--color-accent)' }}>-{effectiveUnlockMin}m</strong> before
              </>
            ) : (
              <>
                <span style={{ fontWeight: 600 }}>🕒 Standard Mode:</span> Locks <strong style={{ color: 'var(--color-accent)' }}>+{effectiveLockMin}m</strong> after end · Unlocks <strong style={{ color: 'var(--color-accent)' }}>-{effectiveUnlockMin}m</strong> before
              </>
            )}
          </div>
        </div>
      </div>

      {/* 5. Live Next Scheduled Window */}
      {nextWindow && (
        <div
          style={{
            padding: '0.625rem 0.75rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(36, 101, 245, 0.05)',
            border: '1px solid rgba(36, 101, 245, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Next Scheduled Door Window
            </span>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)', fontWeight: 600 }}>
              {nextWindow.source_label || mapping.pco_resource_label}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Unlock: {formatIsoTimeOnly(nextWindow.unlock_at)} → Lock: {formatIsoTimeOnly(nextWindow.lock_at)}
            </span>
          </div>

          <span
            className={`badge ${
              nextWindow.status === 'unlocked' ? 'badge-success' :
              nextWindow.status === 'pending' ? 'badge-info' : 'badge-neutral'
            }`}
            style={{ fontSize: '0.6875rem', textTransform: 'capitalize' }}
          >
            {nextWindow.status}
          </span>
        </div>
      )}

      {/* 6. Footer: Timestamps */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.6875rem',
          color: 'var(--color-text-muted)',
          borderTop: '1px solid var(--color-border)',
          paddingTop: '0.625rem',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <span>
          Created: {mapping.created_at ? safeFormat(mapping.created_at, 'MMM d, yyyy · h:mm a') : '—'}
        </span>
        <span>
          Updated: {mapping.updated_at ? safeFormatDistanceToNow(mapping.updated_at) : '—'}
        </span>
      </div>
    </div>
  );
}

// ─── Edit Timing Modal ───────────────────────────────────────────────────────

interface EditTimingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapping: Mapping | null;
  orgSettings: OrgSettings | null;
  onSave: (
    mappingId: string,
    updates: {
      lock_timing_mode?: LockTimingMode;
      lock_offset_min?: number;
      unlock_offset_min?: number;
    },
  ) => Promise<void>;
  saving: boolean;
}

function EditTimingModal({
  isOpen,
  onClose,
  mapping,
  orgSettings,
  onSave,
  saving,
}: EditTimingModalProps) {
  const [timingChoice, setTimingChoice] = useState<'default' | 'after_start' | 'after_end'>('default');
  const [unlockMin, setUnlockMin] = useState(15);
  const [lockMin, setLockMin] = useState(15);

  useEffect(() => {
    if (!mapping) return;
    if (mapping.lock_timing_mode) {
      setTimingChoice(mapping.lock_timing_mode);
    } else {
      setTimingChoice('default');
    }
    setUnlockMin(mapping.unlock_offset_min ?? orgSettings?.unlock_buffer_before_min ?? 15);
    if (mapping.lock_offset_min !== undefined) {
      setLockMin(mapping.lock_offset_min);
    } else {
      const mode = mapping.lock_timing_mode ?? orgSettings?.lock_timing_mode ?? 'after_end';
      setLockMin(mode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15));
    }
  }, [mapping, orgSettings, isOpen]);

  if (!mapping) return null;

  const orgMode = orgSettings?.lock_timing_mode ?? 'after_end';
  const orgUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
  const orgLock = orgMode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15);

  async function handleSave() {
    if (!mapping) return;
    if (timingChoice === 'default') {
      await onSave(mapping.id, {
        lock_timing_mode: undefined,
        lock_offset_min: undefined,
        unlock_offset_min: undefined,
      });
    } else {
      await onSave(mapping.id, {
        lock_timing_mode: timingChoice,
        lock_offset_min: lockMin,
        unlock_offset_min: unlockMin,
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Door Timing — ${mapping.pco_resource_label}`}
      footer={
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Timing Rule'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
            Timing & Locking Rule
          </label>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Choose how doors should lock for <strong>{mapping.pco_resource_label}</strong>. You can lock doors shortly after the service starts for security, or keep them unlocked until after the service ends.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* Option 1: Org Default */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timingChoice === 'default' ? 'rgba(36,101,245,0.08)' : 'var(--color-bg-elevated)',
                border: `1px solid ${timingChoice === 'default' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              <input
                type="radio"
                name="editTimingChoice"
                value="default"
                checked={timingChoice === 'default'}
                onChange={() => setTimingChoice('default')}
                style={{ marginTop: '0.2rem' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                  Use Organization Default ({orgMode === 'after_start' ? '🛡️ Security Mode' : '🕒 Standard Mode'})
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {orgMode === 'after_start'
                    ? `Locks +${orgLock} min after start · Unlocks -${orgUnlock} min before`
                    : `Locks +${orgLock} min after end · Unlocks -${orgUnlock} min before`}
                </span>
              </div>
            </label>

            {/* Option 2: Security Mode (after start) */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timingChoice === 'after_start' ? 'rgba(36,101,245,0.08)' : 'var(--color-bg-elevated)',
                border: `1px solid ${timingChoice === 'after_start' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              <input
                type="radio"
                name="editTimingChoice"
                value="after_start"
                checked={timingChoice === 'after_start'}
                onChange={() => setTimingChoice('after_start')}
                style={{ marginTop: '0.2rem' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                  🛡️ Security Mode — Lock after service starts
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Doors will unlock before the service and automatically lock a set time after the service begins.
                </span>
              </div>
            </label>

            {/* Option 3: Standard Mode (after end) */}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timingChoice === 'after_end' ? 'rgba(36,101,245,0.08)' : 'var(--color-bg-elevated)',
                border: `1px solid ${timingChoice === 'after_end' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              <input
                type="radio"
                name="editTimingChoice"
                value="after_end"
                checked={timingChoice === 'after_end'}
                onChange={() => setTimingChoice('after_end')}
                style={{ marginTop: '0.2rem' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                  🕒 Standard Mode — Lock after service ends
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Doors stay unlocked for the full duration of the service and lock after it concludes.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Sliders if custom mode selected */}
        {timingChoice !== 'default' && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
                  Unlock doors before start
                </label>
                <span style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: '0.8125rem' }}>
                  {unlockMin} min before
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min="0"
                max="60"
                step="5"
                value={unlockMin}
                onChange={(e) => setUnlockMin(Number(e.target.value))}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
                  {timingChoice === 'after_start' ? 'Lock doors after start' : 'Lock doors after end'}
                </label>
                <span style={{ fontWeight: 700, color: 'var(--color-accent)', fontSize: '0.8125rem' }}>
                  {lockMin} min {timingChoice === 'after_start' ? 'after start' : 'after end'}
                </span>
              </div>
              <input
                type="range"
                className="form-range"
                min="0"
                max={timingChoice === 'after_start' ? '120' : '60'}
                step="5"
                value={lockMin}
                onChange={(e) => setLockMin(Number(e.target.value))}
              />
            </div>

            {/* Example preview */}
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-surface)',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--color-border)',
              }}
            >
              💡 <strong>Example:</strong> For a 10:00 AM – 11:30 AM service, doors unlock at{' '}
              <strong>
                {10 - Math.floor(unlockMin / 60)}:{String((60 - (unlockMin % 60)) % 60).padStart(2, '0')}{' '}
                {unlockMin > 0 ? 'AM' : 'AM'}
              </strong>{' '}
              and lock at{' '}
              <strong>
                {timingChoice === 'after_start'
                  ? `${10 + Math.floor(lockMin / 60)}:${String(lockMin % 60).padStart(2, '0')} AM`
                  : `${11 + Math.floor((30 + lockMin) / 60)}:${String((30 + lockMin) % 60).padStart(2, '0')} AM`}
              </strong>.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Add Mapping Modal ────────────────────────────────────────────────────────

interface AddMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: MappingSourceType;
  pcoResources: Array<PcoServiceType | PcoGroup>;
  doors: Door[];
  pcoError?: string | null;
  orgSettings: OrgSettings | null;
  onSave: (data: {
    pco_resource_id: string;
    pco_resource_label: string;
    door_ids: string[];
    door_labels: string[];
    time_types: PlanTimeType[];
    lock_timing_mode?: LockTimingMode;
    lock_offset_min?: number;
    unlock_offset_min?: number;
    enabled: boolean;
  }) => Promise<void>;
  saving: boolean;
}

function AddMappingModal({
  isOpen,
  onClose,
  sourceType,
  pcoResources,
  doors,
  pcoError,
  orgSettings,
  onSave,
  saving,
}: AddMappingModalProps) {
  const [step, setStep] = useState(1);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [timeTypes, setTimeTypes] = useState<PlanTimeType[]>(['service']);
  const [timingChoice, setTimingChoice] = useState<'default' | 'after_start' | 'after_end'>('default');
  const [customUnlockMin, setCustomUnlockMin] = useState(15);
  const [customLockMin, setCustomLockMin] = useState(15);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setSelectedResourceId('');
    setSelectedDoorIds([]);
    setTimeTypes(['service']);
    setTimingChoice('default');
    setCustomUnlockMin(orgSettings?.unlock_buffer_before_min ?? 15);
    setCustomLockMin(15);
    setEnabled(true);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleDoor(id: string) {
    setSelectedDoorIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  function toggleTimeType(tt: PlanTimeType) {
    setTimeTypes((prev) =>
      prev.includes(tt) ? prev.filter((t) => t !== tt) : [...prev, tt],
    );
  }

  const selectedResource = pcoResources.find((r) => r.id === selectedResourceId);

  async function handleSave() {
    setError(null);
    if (!selectedResourceId) { setError('Please select a PCO resource.'); return; }
    if (selectedDoorIds.length === 0) { setError('Please select at least one door.'); return; }
    if (sourceType === 'service' && timeTypes.length === 0) { setError('Please select at least one time type.'); return; }

    const selectedDoors = doors.filter((d) => selectedDoorIds.includes(d.id));

    await onSave({
      pco_resource_id: selectedResourceId,
      pco_resource_label: selectedResource?.name ?? selectedResourceId,
      door_ids: selectedDoorIds,
      door_labels: selectedDoors.map((d) => d.label),
      time_types: sourceType === 'service' ? timeTypes : [],
      lock_timing_mode: timingChoice === 'default' ? undefined : timingChoice,
      lock_offset_min: timingChoice === 'default' ? undefined : customLockMin,
      unlock_offset_min: timingChoice === 'default' ? undefined : customUnlockMin,
      enabled,
    });
    reset();
  }

  const totalSteps = sourceType === 'service' ? 4 : 3;

  const stepLabel = (s: number) => {
    const labels: Record<number, string> = {
      1: 'Select PCO Resource',
      2: 'Select Doors',
      3: sourceType === 'service' ? 'Trigger Time Types' : 'Timing & Review',
      4: 'Timing & Review',
    };
    return labels[s] ?? `Step ${s}`;
  };

  const orgMode = orgSettings?.lock_timing_mode ?? 'after_end';
  const orgUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
  const orgLock = orgMode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Add ${sourceType === 'service' ? 'Service' : 'Group'} Mapping`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button
            className="btn btn-secondary"
            onClick={step === 1 ? handleClose : () => setStep((s) => s - 1)}
            disabled={saving}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < totalSteps ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (step === 1 && !selectedResourceId) ||
                (step === 2 && selectedDoorIds.length === 0)
              }
            >
              Next →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Mapping'}
            </button>
          )}
        </div>
      }
    >
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', alignItems: 'center' }}>
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
          <React.Fragment key={s}>
            <div
              style={{
                width: '1.5rem',
                height: '1.5rem',
                borderRadius: '50%',
                background: s <= step ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
                border: `2px solid ${s <= step ? 'var(--color-accent)' : 'var(--color-border)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.6875rem',
                fontWeight: 700,
                color: s <= step ? '#fff' : 'var(--color-text-muted)',
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
                  background: s < step ? 'var(--color-accent)' : 'var(--color-border)',
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
        Step {step}: {stepLabel(step)}
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Step 1: PCO resource selection */}
      {step === 1 && (
        <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block' }}>
              Choose {sourceType === 'service' ? 'Service Type' : 'Group'}
            </label>
            {pcoError ? (
              <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.875rem' }}>
                Failed to load {sourceType === 'service' ? 'service types' : 'groups'}: {pcoError}
              </p>
            ) : pcoResources.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                No {sourceType === 'service' ? 'service types' : 'groups'} found. Ensure PCO is connected in Settings.
              </p>
            ) : (
              <select
                className="form-select"
                value={selectedResourceId}
                onChange={(e) => setSelectedResourceId(e.target.value)}
              >
                <option value="">Select a {sourceType === 'service' ? 'service type' : 'group'}…</option>
                {pcoResources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {(r as PcoServiceType).frequency ? `(${(r as PcoServiceType).frequency})` : (r as PcoGroup).schedule ? `(${(r as PcoGroup).schedule})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected Resource Preview with Times */}
          {selectedResource && (
            <div
              style={{
                padding: '0.875rem',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{selectedResource.name}</span>
                {(selectedResource as PcoServiceType).frequency && (
                  <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
                    {(selectedResource as PcoServiceType).frequency}
                  </span>
                )}
                {(selectedResource as PcoGroup).schedule && (
                  <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
                    {(selectedResource as PcoGroup).schedule}
                  </span>
                )}
              </div>

              {(selectedResource as PcoServiceType).upcoming_plan_title && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  <strong>Upcoming Plan:</strong> {(selectedResource as PcoServiceType).upcoming_plan_title}
                </div>
              )}

              {selectedResource.upcoming_times && selectedResource.upcoming_times.length > 0 ? (
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Pulled Service / Event Times:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {selectedResource.upcoming_times.map((t) => {
                      const style = timeTypeBadgeStyle(t.time_type);
                      return (
                        <span
                          key={t.id}
                          style={{
                            fontSize: '0.6875rem',
                            padding: '0.2rem 0.4rem',
                            borderRadius: 'var(--radius-sm)',
                            background: style.bg,
                            color: style.color,
                            border: `1px solid ${style.border}`,
                          }}
                        >
                          {formatIsoTimeRange(t.starts_at, t.ends_at)} ({t.time_type || 'time'})
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  No upcoming times scheduled yet in Planning Center.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Door selection */}
      {step === 2 && (
        <div>
          <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
            Select UniFi Doors ({selectedDoorIds.length} selected)
          </label>
          {doors.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              No doors available. Configure the local agent first.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '16rem', overflowY: 'auto' }}>
              {doors.map((door) => (
                <label
                  key={door.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.625rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: selectedDoorIds.includes(door.id)
                      ? 'rgba(36,101,245,0.1)'
                      : 'var(--color-bg-elevated)',
                    border: `1px solid ${selectedDoorIds.includes(door.id) ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                    transition: 'all 0.15s ease',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDoorIds.includes(door.id)}
                    onChange={() => toggleDoor(door.id)}
                  />
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{door.label}</span>
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Time types (services only) */}
      {step === 3 && sourceType === 'service' && (
        <div>
          <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
            Which time types should trigger an unlock?
          </label>
          {(['service', 'rehearsal', 'other'] as PlanTimeType[]).map((tt) => (
            <label
              key={tt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.625rem',
                marginBottom: '0.5rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timeTypes.includes(tt)
                  ? 'rgba(36,101,245,0.1)'
                  : 'var(--color-bg-elevated)',
                border: `1px solid ${timeTypes.includes(tt) ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                transition: 'all 0.15s ease',
                fontSize: '0.9375rem',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={timeTypes.includes(tt)}
                onChange={() => toggleTimeType(tt)}
              />
              <span style={{ color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>{tt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Final step: Timing Rules, Summary & Enable toggle */}
      {((step === 4 && sourceType === 'service') || (step === 3 && sourceType === 'group')) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Timing Configuration Card */}
          <div
            style={{
              padding: '0.875rem',
              background: 'var(--color-bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
              Door Locking Rule
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="addTimingChoice"
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
                  name="addTimingChoice"
                  value="after_start"
                  checked={timingChoice === 'after_start'}
                  onChange={() => setTimingChoice('after_start')}
                />
                <span style={{ fontWeight: timingChoice === 'after_start' ? 600 : 400 }}>
                  🛡️ Security Mode (Lock after service starts)
                </span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="addTimingChoice"
                  value="after_end"
                  checked={timingChoice === 'after_end'}
                  onChange={() => setTimingChoice('after_end')}
                />
                <span style={{ fontWeight: timingChoice === 'after_end' ? 600 : 400 }}>
                  🕒 Standard Mode (Lock after service ends)
                </span>
              </label>
            </div>

            {timingChoice !== 'default' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                    <span>Unlock before:</span>
                    <strong style={{ color: 'var(--color-accent)' }}>{customUnlockMin}m</strong>
                  </div>
                  <input
                    type="range"
                    className="form-range"
                    min="0"
                    max="60"
                    step="5"
                    value={customUnlockMin}
                    onChange={(e) => setCustomUnlockMin(Number(e.target.value))}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                    <span>{timingChoice === 'after_start' ? 'Lock after start:' : 'Lock after end:'}</span>
                    <strong style={{ color: 'var(--color-accent)' }}>{customLockMin}m</strong>
                  </div>
                  <input
                    type="range"
                    className="form-range"
                    min="0"
                    max={timingChoice === 'after_start' ? '120' : '60'}
                    step="5"
                    value={customLockMin}
                    onChange={(e) => setCustomLockMin(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              padding: '0.875rem',
              background: 'var(--color-bg-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              fontSize: '0.8125rem',
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Mapping Summary</div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Resource:</span>{' '}
              <strong>{selectedResource?.name}</strong> ({sourceType})
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Doors ({selectedDoorIds.length}):</span>{' '}
              {doors.filter((d) => selectedDoorIds.includes(d.id)).map((d) => d.label).join(', ')}
            </div>
            {sourceType === 'service' && (
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Time Types:</span>{' '}
                {timeTypes.join(', ')}
              </div>
            )}
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>Locking Rule:</span>{' '}
              {timingChoice === 'default'
                ? `Default (${orgMode === 'after_start' ? `Locks +${orgLock}m after start` : `Locks +${orgLock}m after end`})`
                : timingChoice === 'after_start'
                ? `🛡️ Security Mode: Locks +${customLockMin}m after start · Unlocks -${customUnlockMin}m before`
                : `🕒 Standard Mode: Locks +${customLockMin}m after end · Unlocks -${customUnlockMin}m before`}
            </div>
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
              Mapping Status
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Toggle checked={enabled} onChange={setEnabled} />
              <span style={{ fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}>
                {enabled ? 'Enabled — this mapping will automatically schedule door unlock commands' : 'Disabled — no door actions will be scheduled'}
              </span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MappingsPage() {
  const { orgId } = useAuth();

  const [tab, setTab] = useState<MappingSourceType>('service');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [orgSettings, setOrgSettings] = useState<OrgSettings | null>(null);
  const [pcoResources, setPcoResources] = useState<Array<PcoServiceType | PcoGroup>>([]);
  const [pcoLoading, setPcoLoading] = useState(false);
  const [pcoError, setPcoError] = useState<string | null>(null);
  const [mappingsLoading, setMappingsLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const [editTimingModalOpen, setEditTimingModalOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null);
  const [savingTiming, setSavingTiming] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingLabel, setDeletingLabel] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  function showFeedback(text: string, ok: boolean) {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  // Load initial mappings and org settings
  useEffect(() => {
    if (!orgId) return;
    Promise.all([getMappings(orgId), getOrgSettings(orgId)]).then(([m, s]) => {
      setMappings(m);
      setOrgSettings(s);
      setMappingsLoading(false);
    });
  }, [orgId]);

  // Subscribe to live doors
  useEffect(() => {
    if (!orgId) return;
    const unsub = subscribeToDoors(orgId, (d) => setDoors(d));
    return () => unsub();
  }, [orgId]);

  // Subscribe to live schedule windows
  useEffect(() => {
    if (!orgId) return;
    const unsub = subscribeToScheduleWindows(orgId, (w) => setScheduleWindows(w));
    return () => unsub();
  }, [orgId]);

  // Load PCO resources when tab changes or orgId changes
  const fetchPcoResources = useCallback(() => {
    if (!orgId) return;
    setPcoLoading(true);
    setPcoError(null);
    const getPcoResources = httpsCallable<
      { orgId: string; type: MappingSourceType },
      { items?: Array<PcoServiceType | PcoGroup>; resources?: Array<PcoServiceType | PcoGroup> }
    >(functions, 'getPcoResources');

    getPcoResources({ orgId, type: tab })
      .then((res) => {
        setPcoResources(res.data.items ?? res.data.resources ?? []);
        setPcoError(null);
      })
      .catch((err: any) => {
        console.error('Failed to load PCO resources:', err);
        setPcoError(err?.message || 'Failed to load Planning Center resources.');
        setPcoResources([]);
      })
      .finally(() => setPcoLoading(false));
  }, [orgId, tab]);

  useEffect(() => {
    fetchPcoResources();
  }, [fetchPcoResources]);

  const filteredMappings = mappings.filter((m) => m.source_type === tab);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!orgId) return;
      setToggling(id);
      try {
        await updateMapping(orgId, id, { enabled });
        setMappings((prev) =>
          prev.map((m) => (m.id === id ? { ...m, enabled } : m)),
        );
      } catch {
        showFeedback('Failed to update mapping.', false);
      } finally {
        setToggling(null);
      }
    },
    [orgId],
  );

  function openDeleteModal(id: string, label: string) {
    setDeletingId(id);
    setDeletingLabel(label);
    setDeleteModalOpen(true);
  }

  const handleDeleteConfirm = useCallback(async () => {
    if (!orgId || !deletingId) return;
    setDeleting(true);
    try {
      await deleteMapping(orgId, deletingId);
      setMappings((prev) => prev.filter((m) => m.id !== deletingId));
      setDeleteModalOpen(false);
      showFeedback('Mapping deleted.', true);
    } catch {
      showFeedback('Failed to delete mapping.', false);
    } finally {
      setDeleting(false);
    }
  }, [orgId, deletingId]);

  const handleSaveMapping = useCallback(
    async (data: {
      pco_resource_id: string;
      pco_resource_label: string;
      door_ids: string[];
      door_labels: string[];
      time_types: PlanTimeType[];
      lock_timing_mode?: LockTimingMode;
      lock_offset_min?: number;
      unlock_offset_min?: number;
      enabled: boolean;
    }) => {
      if (!orgId) return;
      setSaving(true);
      try {
        const id = await createMapping(orgId, {
          source_type: tab,
          ...data,
        });
        const newMapping: Mapping = {
          id,
          org_id: orgId,
          source_type: tab,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...data,
        };
        setMappings((prev) => [...prev, newMapping]);
        setModalOpen(false);
        showFeedback('Mapping created successfully.', true);
      } catch {
        showFeedback('Failed to save mapping.', false);
      } finally {
        setSaving(false);
      }
    },
    [orgId, tab],
  );

  const handleUpdateTiming = useCallback(
    async (
      mappingId: string,
      updates: {
        lock_timing_mode?: LockTimingMode;
        lock_offset_min?: number;
        unlock_offset_min?: number;
      },
    ) => {
      if (!orgId) return;
      setSavingTiming(true);
      try {
        await updateMapping(orgId, mappingId, updates);
        setMappings((prev) =>
          prev.map((m) => (m.id === mappingId ? { ...m, ...updates } : m)),
        );
        setEditTimingModalOpen(false);
        setEditingMapping(null);
        showFeedback('Timing rule updated successfully.', true);
      } catch {
        showFeedback('Failed to update timing rule.', false);
      } finally {
        setSavingTiming(false);
      }
    },
    [orgId],
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Mappings</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
          <PlusIcon />
          Add Mapping
        </button>
      </div>

      {feedback && (
        <div className={`alert ${feedback.ok ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1.5rem' }}>
          {feedback.text}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {(['service', 'group'] as MappingSourceType[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'service' ? 'Services' : 'Groups'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.9fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left panel: PCO resources & Pulled Times */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
              {tab === 'service' ? 'PCO Service Types & Times' : 'PCO Groups & Schedules'}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              onClick={fetchPcoResources}
              disabled={pcoLoading}
              title="Refresh resources from Planning Center"
            >
              <RefreshIcon />
            </button>
          </div>

          {pcoLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: '5rem', borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          ) : pcoError ? (
            <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8125rem', marginBottom: '0.75rem', fontWeight: 500 }}>
                {pcoError}
              </p>
              <button
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem' }}
                onClick={fetchPcoResources}
              >
                Retry
              </button>
            </div>
          ) : pcoResources.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p className="empty-state-title" style={{ fontSize: '0.875rem' }}>
                No {tab === 'service' ? 'service types' : 'groups'} found
              </p>
              <p style={{ fontSize: '0.8125rem' }}>
                Ensure Planning Center is connected in Settings.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {pcoResources.map((r) => {
                const isMapped = mappings.some((m) => m.pco_resource_id === r.id);
                const upcomingTimes = r.upcoming_times ?? [];
                const freq = (r as PcoServiceType).frequency;
                const sched = (r as PcoGroup).schedule;
                const planTitle = (r as PcoServiceType).upcoming_plan_title;

                return (
                  <div
                    key={r.id}
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>
                        {r.name}
                      </span>
                      {isMapped ? (
                        <span className="badge badge-success" style={{ fontSize: '0.6875rem' }}>
                          Mapped
                        </span>
                      ) : (
                        <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
                          Unmapped
                        </span>
                      )}
                    </div>

                    {(freq || sched) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <ClockIcon />
                        <span>{freq ? `Frequency: ${freq}` : `Schedule: ${sched}`}</span>
                      </div>
                    )}

                    {planTitle && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Plan: {planTitle}
                      </div>
                    )}

                    {upcomingTimes.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.125rem' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                          Times:
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                          {upcomingTimes.map((t) => {
                            const style = timeTypeBadgeStyle(t.time_type);
                            return (
                              <span
                                key={t.id}
                                style={{
                                  fontSize: '0.6875rem',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: 'var(--radius-sm)',
                                  background: style.bg,
                                  color: style.color,
                                  border: `1px solid ${style.border}`,
                                  fontWeight: 500,
                                }}
                              >
                                {formatIsoTimeRange(t.starts_at, t.ends_at)} {t.time_type ? `(${t.time_type})` : ''}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        No upcoming times scheduled
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right panel: Active Mappings with Full Details */}
        <div>
          <div
            style={{
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: '0.875rem',
              fontSize: '0.875rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Active Mappings ({filteredMappings.length})</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>
              Org Defaults: {orgSettings?.lock_timing_mode === 'after_start' ? '🛡️ Security Mode' : '🕒 Standard Mode'} (-{orgSettings?.unlock_buffer_before_min ?? 15}m / +{orgSettings?.lock_timing_mode === 'after_start' ? (orgSettings?.lock_after_start_min ?? 15) : (orgSettings?.lock_buffer_after_min ?? 15)}m)
            </span>
          </div>

          {mappingsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[1, 2].map((i) => (
                <div key={i} className="card skeleton" style={{ height: '10rem', borderRadius: 'var(--radius-lg)' }} />
              ))}
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">
                No {tab === 'service' ? 'service' : 'group'} mappings yet
              </p>
              <p style={{ fontSize: '0.875rem' }}>
                Click &quot;Add Mapping&quot; to link a Planning Center {tab === 'service' ? 'service type' : 'group'} with UniFi doors.
              </p>
            </div>
          ) : (
            <div>
              {filteredMappings.map((m) => {
                const matchedResource = pcoResources.find((r) => r.id === m.pco_resource_id);

                return (
                  <ActiveMappingCard
                    key={m.id}
                    mapping={m}
                    pcoResource={matchedResource}
                    doors={doors}
                    scheduleWindows={scheduleWindows}
                    orgSettings={orgSettings}
                    onToggle={handleToggle}
                    onDelete={openDeleteModal}
                    onEditTiming={(mappingToEdit) => {
                      setEditingMapping(mappingToEdit);
                      setEditTimingModalOpen(true);
                    }}
                    toggling={toggling === m.id}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Mapping Modal */}
      <AddMappingModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        sourceType={tab}
        pcoResources={pcoResources}
        doors={doors}
        pcoError={pcoError}
        orgSettings={orgSettings}
        onSave={handleSaveMapping}
        saving={saving}
      />

      {/* Edit Timing Modal */}
      <EditTimingModal
        isOpen={editTimingModalOpen}
        onClose={() => {
          setEditTimingModalOpen(false);
          setEditingMapping(null);
        }}
        mapping={editingMapping}
        orgSettings={orgSettings}
        onSave={handleUpdateTiming}
        saving={savingTiming}
      />

      {/* Delete Confirmation */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => !deleting && setDeleteModalOpen(false)}
        title="Delete Mapping"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete the mapping for{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{deletingLabel}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          This will not delete existing schedule windows, but no new automated windows or door commands will be created for this resource.
        </p>
      </Modal>

      <style>{`
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 1.1fr 1.9fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
