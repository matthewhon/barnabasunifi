'use client';

import React, { useEffect, useState } from 'react';
import type { Door, UnifiSchedule, ScheduleWindow } from '@/lib/types';
import { safeFormatDistanceToNow, safeFormat } from '@/lib/date-utils';
import { getDoorUnlockStatus } from '@/lib/door-status-utils';

// ─── Icons ────────────────────────────────────────────────────────────────────

function LockIcon({ color = 'currentColor', size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon({ color = 'currentColor', size = 24 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function QuestionIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface DoorCardProps {
  door: Door;
  schedules?: UnifiSchedule[];
  scheduleWindows?: ScheduleWindow[];
  onUnlock: (door: Door) => void;
  onLock: (door: Door) => void;
  loading?: boolean;
}

export default function DoorCard({
  door,
  schedules = [],
  scheduleWindows = [],
  onUnlock,
  onLock,
  loading = false,
}: DoorCardProps) {
  const [, setTick] = useState(0);

  // Live tick every 30 seconds to update remaining/elapsed countdowns
  useEffect(() => {
    if (door.current_state !== 'unlocked') return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [door.current_state]);

  const isLocked = door.current_state === 'locked';
  const isUnlocked = door.current_state === 'unlocked';
  const isUnknown = door.current_state === 'unknown';

  const statusInfo = getDoorUnlockStatus(door, schedules, scheduleWindows, new Date());

  const borderColor = isUnknown
    ? 'var(--color-border)'
    : isLocked
    ? 'rgba(239, 68, 68, 0.4)'
    : statusInfo.isOutsidePolicy
    ? 'rgba(245, 158, 11, 0.5)'
    : 'rgba(34, 197, 94, 0.4)';

  const bgGlow = isUnknown
    ? 'transparent'
    : isLocked
    ? 'rgba(239, 68, 68, 0.04)'
    : statusInfo.isOutsidePolicy
    ? 'rgba(245, 158, 11, 0.06)'
    : 'rgba(34, 197, 94, 0.04)';

  const stateIcon = isUnknown ? (
    <QuestionIcon size={28} />
  ) : isLocked ? (
    <LockIcon color="var(--color-danger)" size={28} />
  ) : (
    <UnlockIcon color={statusInfo.isOutsidePolicy ? 'var(--color-warning)' : 'var(--color-success)'} size={28} />
  );

  const stateColor = isUnknown
    ? 'var(--color-text-muted)'
    : isLocked
    ? 'var(--color-danger)'
    : statusInfo.isOutsidePolicy
    ? 'var(--color-warning)'
    : 'var(--color-success)';

  const lastSyncedText = door.last_synced
    ? `Synced ${safeFormatDistanceToNow(door.last_synced)}`
    : 'Never synced';

  return (
    <div
      className="card"
      style={{
        borderColor,
        background: `linear-gradient(to bottom, ${bgGlow}, var(--color-bg-surface))`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
    >
      {/* State icon + name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: 'var(--radius-lg)',
            background: isUnknown
              ? 'var(--color-bg-elevated)'
              : isLocked
              ? 'rgba(239, 68, 68, 0.12)'
              : statusInfo.isOutsidePolicy
              ? 'rgba(245, 158, 11, 0.14)'
              : 'rgba(34, 197, 94, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${borderColor}`,
            flexShrink: 0,
          }}
        >
          <span style={{ color: stateColor }}>{stateIcon}</span>
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <h3
            style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {door.label}
          </h3>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
            {lastSyncedText}
          </div>
        </div>
      </div>

      {/* State & Duration badges */}
      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span
          className={`badge ${
            isUnknown
              ? 'badge-neutral'
              : isLocked
              ? 'badge-danger'
              : statusInfo.isOutsidePolicy
              ? 'badge-warning'
              : 'badge-success'
          }`}
          style={{ fontSize: '0.75rem' }}
        >
          <span
            style={{
              width: '0.4rem',
              height: '0.4rem',
              borderRadius: '50%',
              background: 'currentColor',
              display: 'inline-block',
              marginRight: '0.25rem',
            }}
          />
          {isUnknown ? 'Unknown' : isLocked ? 'Locked' : 'Unlocked'}
        </span>

        {door.door_position_status && (
          <span
            className={`badge ${
              door.door_position_status === 'open' ? 'badge-warning' : 'badge-neutral'
            }`}
            style={{ fontSize: '0.75rem' }}
          >
            {door.door_position_status === 'open' ? '🚪 Open' : '🚪 Closed'}
          </span>
        )}

        {isUnlocked && statusInfo.isOutsidePolicy && (
          <span
            className="badge badge-warning"
            style={{ fontSize: '0.75rem', fontWeight: 600, border: '1px solid rgba(245, 158, 11, 0.4)' }}
            title="This door is currently unlocked outside of any scheduled unlock policy or PCO event window."
          >
            ⚠️ Outside Policy
          </span>
        )}

        {door.is_held_unlocked && !statusInfo.isOutsidePolicy && (
          <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
            ⏱️ Hold Open
          </span>
        )}
      </div>

      {/* Unlock Duration & Policy Timing Banner */}
      {isUnlocked && statusInfo.durationLabel && (
        <div
          style={{
            padding: '0.5rem 0.625rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            lineHeight: 1.35,
            background: statusInfo.isOutsidePolicy
              ? 'rgba(245, 158, 11, 0.1)'
              : 'rgba(34, 197, 94, 0.08)',
            border: `1px solid ${
              statusInfo.isOutsidePolicy ? 'rgba(245, 158, 11, 0.25)' : 'rgba(34, 197, 94, 0.2)'
            }`,
            color: statusInfo.isOutsidePolicy ? 'var(--color-warning)' : 'var(--color-success)',
          }}
        >
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span>{statusInfo.isOutsidePolicy ? '⏱️' : '🕒'}</span>
            <span>{statusInfo.durationLabel}</span>
          </div>
          {statusInfo.policyLabel && (
            <div style={{ fontSize: '0.6875rem', opacity: 0.85, marginTop: '0.15rem' }}>
              Policy: {statusInfo.policyLabel}
            </div>
          )}
        </div>
      )}

      {/* Last accessed metadata */}
      {(door.last_accessed_by || door.last_accessed_at) && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.35rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, flexWrap: 'wrap' }}>
            {door.last_accessed_by && (
              <span>👤 Last: <strong style={{ color: 'var(--color-text-primary)' }}>{door.last_accessed_by}</strong></span>
            )}
            {(door.last_access_method_label || door.last_access_method) && (
              <span className="badge badge-neutral" style={{ fontSize: '0.625rem', padding: '0.1rem 0.35rem' }}>
                {door.last_access_method_label || door.last_access_method}
              </span>
            )}
          </div>
          {door.last_accessed_at && (
            <span style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}>
              {safeFormat(door.last_accessed_at, 'MMM d, h:mm a')}
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
        <button
          className="btn btn-success btn-sm"
          style={{
            flex: 1,
            opacity: isUnlocked ? 0.6 : 1,
          }}
          onClick={() => onUnlock(door)}
          disabled={loading}
          title="Temporarily unlock this door"
        >
          <UnlockIcon size={14} color="#fff" />
          Unlock
        </button>
        <button
          className="btn btn-danger btn-sm"
          style={{
            flex: 1,
            opacity: isLocked ? 0.6 : 1,
          }}
          onClick={() => onLock(door)}
          disabled={loading}
          title="Lock this door immediately"
        >
          <LockIcon size={14} />
          Lock
        </button>
      </div>
    </div>
  );
}

