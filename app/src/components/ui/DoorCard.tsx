'use client';

import React from 'react';
import type { Door } from '@unfi-pco/shared';
import { formatDistanceToNow } from 'date-fns';

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
  onUnlock: (door: Door) => void;
  onLock: (door: Door) => void;
  loading?: boolean;
}

export default function DoorCard({ door, onUnlock, onLock, loading = false }: DoorCardProps) {
  const isLocked = door.current_state === 'locked';
  const isUnlocked = door.current_state === 'unlocked';
  const isUnknown = door.current_state === 'unknown';

  const borderColor = isUnknown
    ? 'var(--color-border)'
    : isLocked
    ? 'rgba(239, 68, 68, 0.4)'
    : 'rgba(34, 197, 94, 0.4)';

  const bgGlow = isUnknown
    ? 'transparent'
    : isLocked
    ? 'rgba(239, 68, 68, 0.04)'
    : 'rgba(34, 197, 94, 0.04)';

  const stateIcon = isUnknown ? (
    <QuestionIcon size={28} />
  ) : isLocked ? (
    <LockIcon color="var(--color-danger)" size={28} />
  ) : (
    <UnlockIcon color="var(--color-success)" size={28} />
  );

  const stateColor = isUnknown
    ? 'var(--color-text-muted)'
    : isLocked
    ? 'var(--color-danger)'
    : 'var(--color-success)';

  const lastSyncedText = door.last_synced
    ? `Synced ${formatDistanceToNow(new Date(door.last_synced), { addSuffix: true })}`
    : 'Never synced';

  return (
    <div
      className="card"
      style={{
        borderColor,
        background: `linear-gradient(to bottom, ${bgGlow}, var(--color-bg-surface))`,
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
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

      {/* State badge */}
      <div>
        <span
          className={`badge ${
            isUnknown ? 'badge-neutral' : isLocked ? 'badge-danger' : 'badge-success'
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
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
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
          Unlock Now
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
          Lock Now
        </button>
      </div>
    </div>
  );
}
