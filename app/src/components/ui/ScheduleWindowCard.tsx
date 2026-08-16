'use client';

import React, { useEffect, useState } from 'react';
import type { ScheduleWindow } from '@/lib/types';
import { format, formatDistanceToNow, isPast, isFuture, intervalToDuration } from 'date-fns';

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

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'unlocked': return 'Unlocked';
    case 'locked': return 'Locked';
    case 'cancelled': return 'Cancelled';
    case 'error': return 'Error';
    default: return status;
  }
}

function formatDuration(seconds: number): string {
  const duration = intervalToDuration({ start: 0, end: seconds * 1000 });
  const parts: string[] = [];
  if (duration.hours) parts.push(`${duration.hours}h`);
  if (duration.minutes) parts.push(`${duration.minutes}m`);
  if (!parts.length) parts.push('< 1m');
  return parts.join(' ');
}

// ─── Countdown Hook ───────────────────────────────────────────────────────────

function useCountdown(targetIso: string | null): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!targetIso) return;

    function updateRemaining() {
      const target = new Date(targetIso!);
      const now = new Date();
      const diffMs = target.getTime() - now.getTime();
      if (diffMs <= 0) {
        setRemaining(null);
        return;
      }
      setRemaining(formatDuration(Math.floor(diffMs / 1000)));
    }

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [targetIso]);

  return remaining;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ScheduleWindowCardProps {
  window: ScheduleWindow;
  compact?: boolean;
}

export default function ScheduleWindowCard({ window: win, compact = false }: ScheduleWindowCardProps) {
  const showCountdown =
    win.status === 'pending' && isFuture(new Date(win.unlock_at));

  const countdown = useCountdown(showCountdown ? win.unlock_at : null);

  const unlockAt = new Date(win.unlock_at);
  const lockAt = new Date(win.lock_at);

  const timeRangeLabel = compact
    ? `${format(unlockAt, 'h:mm a')} – ${format(lockAt, 'h:mm a')}`
    : `${format(unlockAt, 'EEE, MMM d · h:mm a')} – ${format(lockAt, 'h:mm a')}`;

  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.5rem 0',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 500,
              fontSize: '0.875rem',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {win.source_label}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
            {timeRangeLabel}
            {win.door_labels.length > 0 && (
              <span> · {win.door_labels.length} door{win.door_labels.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          <span className={`badge ${statusBadgeClass(win.status)}`} style={{ fontSize: '0.6875rem' }}>
            {statusLabel(win.status)}
          </span>
          {countdown && (
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-accent)', marginTop: '0.2rem', fontWeight: 600 }}>
              in {countdown}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-text-primary)', marginBottom: '0.2rem' }}>
            {win.source_label}
          </div>
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
            <span
              className={`badge ${win.source_type === 'service' ? 'badge-info' : 'badge-neutral'}`}
              style={{ fontSize: '0.6875rem' }}
            >
              {win.source_type === 'service' ? 'Service' : 'Group'}
            </span>
            <span className={`badge ${statusBadgeClass(win.status)}`} style={{ fontSize: '0.6875rem' }}>
              {statusLabel(win.status)}
            </span>
          </div>
        </div>

        {/* Countdown badge */}
        {countdown && (
          <div
            style={{
              flexShrink: 0,
              background: 'rgba(36, 101, 245, 0.12)',
              border: '1px solid rgba(36, 101, 245, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '0.375rem 0.75rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.6875rem', color: 'var(--color-accent)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Unlocks in
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-accent)', lineHeight: 1.2 }}>
              {countdown}
            </div>
          </div>
        )}
      </div>

      {/* Time range */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          color: 'var(--color-text-secondary)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span>
          {format(unlockAt, 'EEE, MMM d, yyyy')}
          {'  '}
          {format(unlockAt, 'h:mm a')}
          {' — '}
          {format(lockAt, 'h:mm a')}
        </span>
        {isPast(lockAt) && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            ({formatDistanceToNow(lockAt, { addSuffix: true })})
          </span>
        )}
      </div>

      {/* Doors */}
      {win.door_labels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', alignItems: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {win.door_labels.map((label) => (
            <span
              key={label}
              className="badge badge-neutral"
              style={{ fontSize: '0.6875rem' }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
