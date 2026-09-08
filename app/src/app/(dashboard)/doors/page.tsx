'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import {
  subscribeToDoors,
  subscribeToAgents,
  subscribeToUnifiSchedules,
  subscribeToScheduleWindows,
  subscribeToCampuses,
  subscribeToLocations,
  createDoorCommand,
  getLatestAgentRelease,
  approveAgentUpdate,
  setAgentAutoUpdate,
} from '@/lib/firestore';
import type { Door, Agent, UnifiSchedule, ScheduleWindow, AgentRelease, PcoCampus, PcoLocation } from '@/lib/types';
import { safeFormatDistanceToNow, safeFormat } from '@/lib/date-utils';
import { getDoorUnlockStatus } from '@/lib/door-status-utils';
import Modal from '@/components/ui/Modal';

// ─── Icons ────────────────────────────────────────────────────────────────────

function LockIcon({ color = 'currentColor', size = 22 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnlockIcon({ color = 'currentColor', size = 22 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function ServerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
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
      style={{
        animation: spinning ? 'spin 1s linear infinite' : 'none',
      }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function MapPinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

// ─── Door Card ────────────────────────────────────────────────────────────────

interface DoorCardProps {
  door: Door;
  schedules?: UnifiSchedule[];
  scheduleWindows?: ScheduleWindow[];
  onUnlock: (door: Door) => void;
  onLock: (door: Door) => void;
  onEditCampusLocation?: (door: Door) => void;
  selected?: boolean;
  onSelectToggle?: (door: Door) => void;
  actionLoading: boolean;
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

function getFriendlyScheduleName(name?: string | null, fallbackDoorLabel?: string): string {
  if (!name || !name.trim()) return fallbackDoorLabel ? `${fallbackDoorLabel} Unlock Schedule` : 'Unlock Schedule';
  const trimmed = name.trim();
  if (isUuid(trimmed) || trimmed.toLowerCase() === 'schedule' || trimmed.startsWith('unlock-')) {
    return fallbackDoorLabel ? `${fallbackDoorLabel} Unlock Schedule` : 'Unlock Schedule';
  }
  return trimmed;
}

function DoorCard({
  door,
  schedules = [],
  scheduleWindows = [],
  onUnlock,
  onLock,
  onEditCampusLocation,
  selected = false,
  onSelectToggle,
  actionLoading,
}: DoorCardProps) {
  const [, setTick] = useState(0);

  // Live timer tick every 30s to update countdowns
  useEffect(() => {
    if (door.current_state !== 'unlocked') return;
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [door.current_state]);

  const isLocked = door.current_state === 'locked';
  const isUnlocked = door.current_state === 'unlocked';
  const isUnknown = door.current_state === 'unknown';

  const statusInfo = getDoorUnlockStatus(door, schedules, scheduleWindows, new Date());

  const assignedSchedules = schedules.filter((s) => {
    const doorId = door.id;
    const unifiDoorId = door.unifi_door_id;
    return s.door_ids?.includes(doorId) || (unifiDoorId && s.door_ids?.includes(unifiDoorId));
  });

  const rawScheduleLabel = door.schedule_name || door.unlock_schedule_name;
  const friendlyScheduleLabel = rawScheduleLabel ? getFriendlyScheduleName(rawScheduleLabel, door.label) : null;

  const borderColor = selected
    ? 'var(--color-accent)'
    : isUnknown
    ? 'var(--color-border)'
    : isLocked
    ? 'rgba(239,68,68,0.35)'
    : statusInfo.isOutsidePolicy
    ? 'rgba(245,158,11,0.5)'
    : 'rgba(34,197,94,0.35)';

  const bgGlow = selected
    ? 'rgba(36,101,245,0.06)'
    : isUnknown
    ? 'transparent'
    : isLocked
    ? 'rgba(239,68,68,0.03)'
    : statusInfo.isOutsidePolicy
    ? 'rgba(245,158,11,0.05)'
    : 'rgba(34,197,94,0.03)';

  return (
    <div
      className="card"
      style={{
        borderColor,
        boxShadow: selected ? '0 0 0 2px rgba(36,101,245,0.2)' : undefined,
        background: `linear-gradient(to bottom, ${bgGlow}, var(--color-bg-surface))`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', minWidth: 0, flex: 1 }}>
          {onSelectToggle && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelectToggle(door)}
              style={{ marginTop: '0.2rem', cursor: 'pointer', flexShrink: 0 }}
              title="Select for batch campus/location mapping"
            />
          )}
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
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
              {door.last_synced
                ? `Synced ${safeFormatDistanceToNow(door.last_synced)}`
                : 'Never synced'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          {onEditCampusLocation && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '0.25rem 0.35rem', color: 'var(--color-text-muted)', fontSize: '0.75rem', height: 'auto' }}
              onClick={() => onEditCampusLocation(door)}
              title="Assign Campus & Location"
            >
              <MapPinIcon />
            </button>
          )}
          <div style={{ marginTop: '0.125rem' }}>
            {isUnknown ? (
              <LockIcon color="var(--color-text-muted)" />
            ) : isLocked ? (
              <LockIcon color="var(--color-danger)" />
            ) : (
              <UnlockIcon color={statusInfo.isOutsidePolicy ? 'var(--color-warning)' : 'var(--color-success)'} />
            )}
          </div>
        </div>
      </div>

      {/* State & Location badges */}
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
        >
          {isUnknown ? 'Unknown' : isLocked ? 'Locked' : 'Unlocked'}
        </span>

        {door.door_position_status && (
          <span
            className={`badge ${
              door.door_position_status === 'open' ? 'badge-warning' : 'badge-neutral'
            }`}
            style={{ fontSize: '0.6875rem' }}
          >
            {door.door_position_status === 'open' ? '🚪 Open' : '🚪 Closed'}
          </span>
        )}

        {/* Campus & Location Tags */}
        {door.campus_name ? (
          <span
            className="badge badge-info"
            style={{ fontSize: '0.6875rem', gap: '0.25rem', cursor: onEditCampusLocation ? 'pointer' : 'default' }}
            onClick={() => onEditCampusLocation?.(door)}
            title={`Campus: ${door.campus_name} (click to edit)`}
          >
            🏫 {door.campus_name}
          </span>
        ) : (
          onEditCampusLocation && (
            <span
              className="badge badge-neutral"
              style={{ fontSize: '0.6875rem', opacity: 0.65, cursor: 'pointer', borderStyle: 'dashed' }}
              onClick={() => onEditCampusLocation(door)}
              title="Click to assign a Planning Center campus"
            >
              + Campus
            </span>
          )
        )}

        {door.location_name && (
          <span
            className="badge badge-neutral"
            style={{
              fontSize: '0.6875rem',
              gap: '0.25rem',
              border: '1px solid var(--color-border)',
              background: 'rgba(168,85,247,0.08)',
              color: '#9333ea',
              cursor: onEditCampusLocation ? 'pointer' : 'default',
            }}
            onClick={() => onEditCampusLocation?.(door)}
            title={`Location / Room: ${door.location_name} (click to edit)`}
          >
            📍 {door.location_name}
          </span>
        )}

        {isUnlocked && statusInfo.isOutsidePolicy && (
          <span
            className="badge badge-warning"
            style={{ fontSize: '0.6875rem', fontWeight: 600, border: '1px solid rgba(245,158,11,0.4)' }}
            title="This door is currently unlocked outside active scheduled policies or event windows."
          >
            ⚠️ Outside Policy
          </span>
        )}

        {door.is_held_unlocked && !statusInfo.isOutsidePolicy && (
          <span className="badge badge-warning" style={{ fontSize: '0.6875rem' }}>
            ⏱️ Hold Open
          </span>
        )}

        {assignedSchedules.length > 0 ? (
          assignedSchedules.map((s) => (
            <Link
              key={s.id}
              href="/schedule"
              style={{ textDecoration: 'none' }}
              title={`Assigned to UniFi schedule: ${getFriendlyScheduleName(s.name, door.label)}`}
            >
              <span
                className="badge badge-neutral"
                style={{
                  fontSize: '0.6875rem',
                  gap: '0.25rem',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
              >
                🗓️ {getFriendlyScheduleName(s.name, door.label)}
              </span>
            </Link>
          ))
        ) : friendlyScheduleLabel ? (
          <Link
            href="/schedule"
            style={{ textDecoration: 'none' }}
            title={`Assigned door schedule: ${friendlyScheduleLabel}`}
          >
            <span
              className="badge badge-neutral"
              style={{
                fontSize: '0.6875rem',
                gap: '0.25rem',
                border: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
            >
              🗓️ {friendlyScheduleLabel}
            </span>
          </Link>
        ) : null}
      </div>

      {/* Unlock Duration & Policy Timing Banner */}
      {isUnlocked && statusInfo.durationLabel && (
        <div
          style={{
            padding: '0.45rem 0.6rem',
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
            marginTop: '0.15rem',
            width: '100%',
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

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
        <button
          className="btn btn-success btn-sm"
          style={{ flex: 1 }}
          onClick={() => onUnlock(door)}
          disabled={actionLoading}
        >
          <UnlockIcon size={14} color="#fff" />
          Unlock
        </button>
        <button
          className="btn btn-danger btn-sm"
          style={{ flex: 1 }}
          onClick={() => onLock(door)}
          disabled={actionLoading}
        >
          <LockIcon size={14} color="currentColor" />
          Lock
        </button>
      </div>
    </div>
  );
}

// ─── Agent Status ─────────────────────────────────────────────────────────────

function AgentStatusRow({
  agent,
  latestVersion,
}: {
  agent: Agent;
  latestVersion: string | null;
}) {
  const isOnline = agent.status === 'online';
  const isDegraded = agent.status === 'degraded';
  const targetVersion = agent.latest_version || latestVersion;
  const localVer = agent.version;
  const isOutdated = Boolean(targetVersion && localVer && localVer !== targetVersion);
  const isAhead = Boolean(targetVersion && localVer && localVer > targetVersion);
  const isExactMatch = Boolean(targetVersion && localVer && localVer === targetVersion);

  const [approving, setApproving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const isUpdating =
    agent.update_status === 'downloading' ||
    agent.update_status === 'applying' ||
    agent.update_status === 'restarting';

  const isApprovedWaiting =
    isOutdated &&
    agent.update_approved_version === targetVersion &&
    !isUpdating &&
    agent.update_status !== 'error';

  const handleApprove = async () => {
    if (!targetVersion) return;
    setApproving(true);
    setMsg(null);
    try {
      await approveAgentUpdate(agent.id, targetVersion, agent.org_id);
      setMsg(`Approved! Agent will deploy v${targetVersion}.`);
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setApproving(false);
    }
  };

  const handleRestart = async () => {
    if (!agent.org_id) return;
    if (!window.confirm(`Send restart signal to reboot Docker agent "${agent.label || agent.id}"?`)) {
      return;
    }
    setRestarting(true);
    setMsg(null);
    try {
      await createDoorCommand(agent.org_id, {
        org_id: agent.org_id,
        action: 'restart_agent',
        status: 'queued',
        execute_at: new Date().toISOString(),
        triggered_by: 'manual',
      });
      setMsg('Restart command queued! Docker container is rebooting…');
    } catch (err: any) {
      setMsg(`Error sending restart command: ${err.message}`);
    } finally {
      setRestarting(false);
    }
  };

  const handleToggleAuto = async () => {
    setTogglingAuto(true);
    try {
      await setAgentAutoUpdate(agent.id, !agent.auto_update);
    } catch (err: any) {
      alert(`Failed to update auto-deploy: ${err.message}`);
    } finally {
      setTogglingAuto(false);
    }
  };

  return (
    <div
      style={{
        padding: '0.875rem 0',
        borderBottom: '1px solid var(--color-border)',
        fontSize: '0.875rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '0.5rem',
              height: '0.5rem',
              borderRadius: '50%',
              flexShrink: 0,
              background: isOnline
                ? 'var(--color-success)'
                : isDegraded
                ? 'var(--color-warning)'
                : 'var(--color-text-muted)',
              boxShadow: isOnline ? '0 0 0 3px rgba(34,197,94,0.25)' : undefined,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {agent.label}
            </span>
            <span className="badge badge-neutral" style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
              v{localVer}
            </span>
            {agent.local_ip ? (
              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', fontFamily: 'monospace', gap: '0.25rem', color: '#38bdf8' }}>
                📍 IP: {agent.local_ip}
              </span>
            ) : (
              <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', opacity: 0.75 }}>
                📍 IP: Detecting…
              </span>
            )}
            {targetVersion ? (
              isOutdated ? (
                <span
                  className="badge badge-warning"
                  style={{ fontSize: '0.6875rem', fontWeight: 600 }}
                >
                  ⚠️ Update available: Behind v{localVer} → v{targetVersion}
                </span>
              ) : isExactMatch ? (
                <span className="badge badge-success" style={{ fontSize: '0.6875rem', fontWeight: 600 }}>
                  ✅ Up to date (v{targetVersion})
                </span>
              ) : isAhead ? (
                <span className="badge badge-neutral" style={{ fontSize: '0.6875rem', fontWeight: 600 }}>
                  ⚡ Ahead of release (v{localVer} &gt; v{targetVersion})
                </span>
              ) : null
            ) : null}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {agent.hostname && <span>Host: {agent.hostname}</span>}
            <span>Capabilities: {agent.capabilities?.join(', ') || 'door management'}</span>
          </div>
        </div>

        {/* Update action / status controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          {isUpdating && (
            <span
              className="badge badge-warning"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.75rem',
                padding: '0.25rem 0.5rem',
              }}
            >
              <span>⚙️</span>
              {agent.update_status === 'downloading'
                ? 'Downloading update…'
                : agent.update_status === 'applying'
                ? 'Installing update…'
                : 'Restarting agent…'}
            </span>
          )}

          {isApprovedWaiting && (
            <span
              className="badge badge-warning"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
            >
              ⏳ Approved — agent deploying shortly…
            </span>
          )}

          {agent.update_status === 'error' && (
            <span
              className="badge badge-danger"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
              title={agent.update_error || undefined}
            >
              ⚠️ Update failed: {agent.update_error || 'Unknown error'}
            </span>
          )}

          {isOutdated && !isUpdating && !isApprovedWaiting && (
            <button
              className="btn btn-primary"
              style={{
                fontSize: '0.75rem',
                padding: '0.25rem 0.625rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
              onClick={handleApprove}
              disabled={approving}
            >
              {approving ? 'Approving…' : `🚀 Deploy v${targetVersion}`}
            </button>
          )}

          {/* Restart Docker Container Button */}
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.625rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            onClick={handleRestart}
            disabled={restarting}
            title="Reboot the local Docker agent container"
          >
            {restarting ? 'Rebooting…' : '🔄 Restart Container'}
          </button>

          {/* Auto-deploy toggle */}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              padding: '0.25rem 0.5rem',
              borderRadius: '6px',
              userSelect: 'none',
            }}
            title="When enabled, newly published releases deploy to this agent automatically without needing manual approval."
          >
            <input
              type="checkbox"
              checked={Boolean(agent.auto_update)}
              onChange={handleToggleAuto}
              disabled={togglingAuto}
              style={{ cursor: 'pointer' }}
            />
            <span>Auto-Deploy</span>
          </label>

          {/* Agent status badge */}
          <div style={{ textAlign: 'right', minWidth: '70px' }}>
            <span
              className={`badge ${
                isOnline ? 'badge-success' : isDegraded ? 'badge-warning' : 'badge-neutral'
              }`}
              style={{ fontSize: '0.75rem' }}
            >
              {agent.status}
            </span>
            <div
              style={{
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
                marginTop: '0.2rem',
              }}
            >
              {agent.last_heartbeat ? safeFormatDistanceToNow(agent.last_heartbeat) : '—'}
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div
          style={{
            fontSize: '0.75rem',
            marginTop: '0.375rem',
            color: msg.startsWith('Error') ? 'var(--color-danger)' : 'var(--color-success)',
          }}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DoorsPage() {
  const { orgId, user } = useAuth();

  const [doors, setDoors] = useState<Door[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [schedules, setSchedules] = useState<UnifiSchedule[]>([]);
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [campuses, setCampuses] = useState<PcoCampus[]>([]);
  const [locations, setLocations] = useState<PcoLocation[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [latestRelease, setLatestRelease] = useState<AgentRelease | null>(null);

  // Filters & Search
  const [selectedCampusFilter, setSelectedCampusFilter] = useState<string>('all'); // 'all' | 'unassigned' | campusId
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Batch selection
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);

  // Unlock modal state
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [selectedDoor, setSelectedDoor] = useState<Door | null>(null);
  const [unlockDuration, setUnlockDuration] = useState(30);

  // Confirmation modal for lock
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockDoor, setLockDoor] = useState<Door | null>(null);

  // Assign Campus & Location Modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [doorsToAssign, setDoorsToAssign] = useState<Door[]>([]);
  const [targetCampusId, setTargetCampusId] = useState<string>('');
  const [customCampusName, setCustomCampusName] = useState<string>('');
  const [targetLocationId, setTargetLocationId] = useState<string>('');
  const [customLocationName, setCustomLocationName] = useState<string>('');
  const [assigning, setAssigning] = useState(false);

  // Sync states
  const [syncingDoors, setSyncingDoors] = useState(false);
  const [syncingCampuses, setSyncingCampuses] = useState(false);

  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!orgId) return;

    const unsubDoors = subscribeToDoors(orgId, (d) => {
      setDoors(d);
      setLoading(false);
    });

    const unsubAgents = subscribeToAgents(orgId, (a) => {
      setAgents(a);
    });

    const unsubSchedules = subscribeToUnifiSchedules(orgId, (s) => {
      setSchedules(s);
    });

    const unsubWindows = subscribeToScheduleWindows(orgId, (w) => {
      setScheduleWindows(w);
    });

    const unsubCampuses = subscribeToCampuses(orgId, (c) => {
      setCampuses(c);
    });

    const unsubLocations = subscribeToLocations(orgId, (l) => {
      setLocations(l);
    });

    // Fetch latest release for version comparison
    getLatestAgentRelease().then((r) => setLatestRelease(r)).catch(() => {});

    return () => {
      unsubDoors();
      unsubAgents();
      unsubSchedules();
      unsubWindows();
      unsubCampuses();
      unsubLocations();
    };
  }, [orgId]);

  function showFeedback(message: string, type: 'success' | 'error') {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 4000);
  }

  function openUnlockModal(door: Door) {
    setSelectedDoor(door);
    setUnlockDuration(30);
    setUnlockModalOpen(true);
  }

  function openLockModal(door: Door) {
    setLockDoor(door);
    setLockModalOpen(true);
  }

  function openAssignModalForSingle(door: Door) {
    setDoorsToAssign([door]);
    setTargetCampusId(door.campus_id || (door.campus_name ? 'custom' : ''));
    setCustomCampusName(door.campus_name || '');
    setTargetLocationId(door.location_id || (door.location_name ? 'custom' : ''));
    setCustomLocationName(door.location_name || '');
    setAssignModalOpen(true);
  }

  function openAssignModalForBatch() {
    const selected = validDoors.filter((d) => selectedDoorIds.includes(d.id));
    if (selected.length === 0) return;
    setDoorsToAssign(selected);
    setTargetCampusId('');
    setCustomCampusName('');
    setTargetLocationId('');
    setCustomLocationName('');
    setAssignModalOpen(true);
  }

  const handleDoorSelectToggle = useCallback((door: Door) => {
    setSelectedDoorIds((prev) =>
      prev.includes(door.id) ? prev.filter((id) => id !== door.id) : [...prev, door.id]
    );
  }, []);

  const handleSelectAllFiltered = useCallback((doorsToSelect: Door[]) => {
    setSelectedDoorIds(doorsToSelect.map((d) => d.id));
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedDoorIds([]);
  }, []);

  const handleUnlockConfirm = useCallback(async () => {
    if (!orgId || !selectedDoor || !user) return;
    setActionLoading(true);
    try {
      await createDoorCommand(orgId, {
        org_id: orgId,
        door_id: selectedDoor.id,
        unifi_door_id: selectedDoor.unifi_door_id || selectedDoor.id,
        door_label: selectedDoor.label,
        action: 'unlock',
        execute_at: new Date().toISOString(),
        duration_min: unlockDuration,
        triggered_by: 'manual',
        actor_uid: user.uid,
        status: 'queued',
      });
      setUnlockModalOpen(false);
      showFeedback(`Unlock command sent for "${selectedDoor.label}".`, 'success');
    } catch {
      showFeedback('Failed to send unlock command. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  }, [orgId, selectedDoor, user, unlockDuration]);

  const handleLockConfirm = useCallback(async () => {
    if (!orgId || !lockDoor || !user) return;
    setActionLoading(true);
    try {
      await createDoorCommand(orgId, {
        org_id: orgId,
        door_id: lockDoor.id,
        unifi_door_id: lockDoor.unifi_door_id || lockDoor.id,
        door_label: lockDoor.label,
        action: 'lock',
        execute_at: new Date().toISOString(),
        triggered_by: 'manual',
        actor_uid: user.uid,
        status: 'queued',
      });
      setLockModalOpen(false);
      showFeedback(`Lock command sent for "${lockDoor.label}".`, 'success');
    } catch {
      showFeedback('Failed to send lock command. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  }, [orgId, lockDoor, user]);

  const handleSyncDoors = useCallback(async () => {
    if (!orgId) return;
    setSyncingDoors(true);
    setFeedback(null);
    try {
      const fn = httpsCallable(functions, 'syncUnifiDoors');
      const res = (await fn({ orgId })) as { data: { success: boolean; mode: string; count?: number } };
      if (res.data?.mode === 'remote') {
        showFeedback(`Successfully discovered and synced ${res.data.count ?? 0} door(s) from UniFi Access.`, 'success');
      } else {
        showFeedback('Door discovery sync command sent to local agent. Updating doors…', 'success');
      }
    } catch (err: any) {
      showFeedback(err.message || 'Failed to sync doors from UniFi Access.', 'error');
    } finally {
      setSyncingDoors(false);
    }
  }, [orgId]);

  const handleSyncCampuses = useCallback(async () => {
    if (!orgId) return;
    setSyncingCampuses(true);
    setFeedback(null);
    try {
      const fn = httpsCallable(functions, 'getPcoCampusesAndLocations');
      const res = (await fn({ orgId })) as { data: { campuses: PcoCampus[]; locations: PcoLocation[] } };
      const cCount = res.data?.campuses?.length ?? 0;
      const lCount = res.data?.locations?.length ?? 0;
      showFeedback(`Successfully synced ${cCount} campus(es) and ${lCount} location(s) from Planning Center.`, 'success');
    } catch (err: any) {
      showFeedback(err.message || 'Failed to fetch campuses & locations from Planning Center.', 'error');
    } finally {
      setSyncingCampuses(false);
    }
  }, [orgId]);

  const handleSaveAssign = useCallback(async () => {
    if (!orgId || doorsToAssign.length === 0) return;
    setAssigning(true);

    let campusName: string | null = null;
    let campusId: string | null = null;
    if (targetCampusId === 'custom') {
      campusName = customCampusName.trim() || null;
    } else if (targetCampusId) {
      const matched = campuses.find((c) => c.id === targetCampusId);
      campusId = targetCampusId;
      campusName = matched?.name || null;
    }

    let locationName: string | null = null;
    let locationId: string | null = null;
    if (targetLocationId === 'custom') {
      locationName = customLocationName.trim() || null;
    } else if (targetLocationId) {
      const matched = locations.find((l) => l.id === targetLocationId);
      locationId = targetLocationId;
      locationName = matched?.name || null;
    }

    try {
      const fn = httpsCallable(functions, 'assignDoorsToCampusLocation');
      await fn({
        orgId,
        doorIds: doorsToAssign.map((d) => d.id),
        campusId,
        campusName,
        locationId,
        locationName,
      });

      setAssignModalOpen(false);
      setSelectedDoorIds([]);
      showFeedback(
        `Successfully mapped ${doorsToAssign.length} door(s) to ${campusName || 'Unassigned'} / ${locationName || 'No specific room'}.`,
        'success'
      );
    } catch (err: any) {
      showFeedback(err.message || 'Failed to assign campus and location.', 'error');
    } finally {
      setAssigning(false);
    }
  }, [orgId, doorsToAssign, targetCampusId, customCampusName, targetLocationId, customLocationName, campuses, locations]);

  const onlineAgents = agents.filter((a) => a.status === 'online').length;

  const validDoors = useMemo(() => {
    return doors.filter((d) => {
      const label = (d.label || '').trim();
      if (!label) return false;
      if (isUuid(label) && d.current_state === 'unknown') return false;
      return true;
    });
  }, [doors]);

  // Derive unique campuses list from both synced campuses and existing door mappings
  const allAvailableCampuses = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    campuses.forEach((c) => map.set(c.id, { id: c.id, name: c.name }));
    validDoors.forEach((d) => {
      if (d.campus_id && d.campus_name && !map.has(d.campus_id)) {
        map.set(d.campus_id, { id: d.campus_id, name: d.campus_name });
      } else if (d.campus_name && !d.campus_id && !map.has(`name-${d.campus_name}`)) {
        map.set(`name-${d.campus_name}`, { id: `name-${d.campus_name}`, name: d.campus_name });
      }
    });
    return Array.from(map.values());
  }, [campuses, validDoors]);

  // Filtered doors according to campus, location, and search
  const filteredDoors = useMemo(() => {
    return validDoors.filter((d) => {
      // Campus filter
      if (selectedCampusFilter === 'unassigned') {
        if (d.campus_id || d.campus_name) return false;
      } else if (selectedCampusFilter !== 'all') {
        const matchesId = d.campus_id === selectedCampusFilter;
        const matchesCustomName = `name-${d.campus_name}` === selectedCampusFilter || d.campus_name === selectedCampusFilter;
        if (!matchesId && !matchesCustomName) return false;
      }

      // Location filter
      if (selectedLocationFilter !== 'all') {
        const matchesLocId = d.location_id === selectedLocationFilter;
        const matchesLocName = d.location_name === selectedLocationFilter;
        if (!matchesLocId && !matchesLocName) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchLabel = d.label?.toLowerCase().includes(q);
        const matchCampus = d.campus_name?.toLowerCase().includes(q);
        const matchLoc = d.location_name?.toLowerCase().includes(q);
        const matchBuild = d.building?.toLowerCase().includes(q);
        const matchFloor = d.floor?.toLowerCase().includes(q);
        if (!matchLabel && !matchCampus && !matchLoc && !matchBuild && !matchFloor) return false;
      }

      return true;
    });
  }, [validDoors, selectedCampusFilter, selectedLocationFilter, searchQuery]);

  const outsidePolicyDoors = useMemo(() => {
    return validDoors.filter((d) => {
      const status = getDoorUnlockStatus(d, schedules, scheduleWindows);
      return status.isOutsidePolicy;
    });
  }, [validDoors, schedules, scheduleWindows]);

  const unassignedCampusCount = validDoors.filter((d) => !d.campus_id && !d.campus_name).length;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 className="page-title">Doors</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            <ServerIcon />
            <span>
              {onlineAgents}/{agents.length} agent{agents.length !== 1 ? 's' : ''} online
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={handleSyncCampuses}
            disabled={syncingCampuses}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
            }}
            title="Fetch latest Campuses and Rooms/Locations from Planning Center"
          >
            <RefreshIcon spinning={syncingCampuses} />
            <span>{syncingCampuses ? 'Syncing Campuses…' : 'Sync PCO Campuses'}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleSyncDoors}
            disabled={syncingDoors}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
            }}
            title="Force a discovery scan with UniFi Access to detect newly added or updated doors"
          >
            <RefreshIcon spinning={syncingDoors} />
            <span>{syncingDoors ? 'Scanning UniFi…' : 'Scan for New Doors'}</span>
          </button>
        </div>
      </div>

      {/* Outside Policy Warning Banner */}
      {outsidePolicyDoors.length > 0 && (
        <div
          className="alert alert-warning"
          style={{
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            border: '1px solid rgba(245, 158, 11, 0.4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <strong>
                {outsidePolicyDoors.length} door{outsidePolicyDoors.length !== 1 ? 's are' : ' is'} currently unlocked outside scheduled policy:
              </strong>{' '}
              {outsidePolicyDoors.map((d) => {
                const s = getDoorUnlockStatus(d, schedules, scheduleWindows);
                return `${d.label} (${s.durationLabel || 'unlocked'})`;
              }).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div
          className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.5rem' }}
        >
          {feedback.message}
        </div>
      )}

      {/* Campus & Location Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
          marginBottom: '1.25rem',
          background: 'var(--color-bg-surface)',
          padding: '0.875rem 1rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Campus Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', marginRight: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Campus:
            </span>
            <button
              className={`btn btn-sm ${selectedCampusFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem' }}
              onClick={() => { setSelectedCampusFilter('all'); setSelectedLocationFilter('all'); }}
            >
              All Campuses ({validDoors.length})
            </button>
            {allAvailableCampuses.map((c) => {
              const count = validDoors.filter((d) => d.campus_id === c.id || d.campus_name === c.name || `name-${d.campus_name}` === c.id).length;
              return (
                <button
                  key={c.id}
                  className={`btn btn-sm ${selectedCampusFilter === c.id ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem' }}
                  onClick={() => { setSelectedCampusFilter(c.id); setSelectedLocationFilter('all'); }}
                >
                  🏫 {c.name} ({count})
                </button>
              );
            })}
            {unassignedCampusCount > 0 && (
              <button
                className={`btn btn-sm ${selectedCampusFilter === 'unassigned' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '0.8125rem', padding: '0.25rem 0.625rem', opacity: selectedCampusFilter === 'unassigned' ? 1 : 0.75 }}
                onClick={() => { setSelectedCampusFilter('unassigned'); setSelectedLocationFilter('all'); }}
              >
                Unassigned ({unassignedCampusCount})
              </button>
            )}
          </div>

          {/* Location & Search Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', minWidth: '16rem' }}>
            {locations.length > 0 && (
              <select
                className="input"
                style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem', height: 'auto', width: 'auto', minWidth: '8.5rem' }}
                value={selectedLocationFilter}
                onChange={(e) => setSelectedLocationFilter(e.target.value)}
              >
                <option value="all">All Rooms / Locations</option>
                {locations
                  .filter((l) => selectedCampusFilter === 'all' || !l.campus_id || l.campus_id === selectedCampusFilter)
                  .map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      📍 {loc.name}
                    </option>
                  ))}
              </select>
            )}

            <input
              type="text"
              className="input"
              placeholder="Search doors…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: '0.8125rem', padding: '0.3rem 0.6rem', height: 'auto', minWidth: '9rem', flex: 1 }}
            />
          </div>
        </div>

        {/* Batch Selection Banner */}
        {selectedDoorIds.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.5rem 0.75rem',
              background: 'rgba(36, 101, 245, 0.08)',
              border: '1px solid rgba(36, 101, 245, 0.3)',
              borderRadius: 'var(--radius-md)',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              <span>✓ {selectedDoorIds.length} door(s) selected</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', height: 'auto' }}
                onClick={() => handleSelectAllFiltered(filteredDoors)}
              >
                Select all {filteredDoors.length} filtered
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className="btn btn-primary btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                onClick={openAssignModalForBatch}
              >
                <MapPinIcon size={13} />
                Assign Campus & Location
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', height: 'auto' }}
                onClick={handleDeselectAll}
              >
                Deselect All
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Door Grid */}
      {loading ? (
        <div className="grid grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card skeleton" style={{ height: '10rem' }} />
          ))}
        </div>
      ) : validDoors.length === 0 ? (
        <div className="card empty-state" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <p className="empty-state-title">No doors found</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1.25rem' }}>
            The local UniFi agent populates doors automatically once it connects. You can also trigger an immediate scan to discover doors from UniFi Access.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleSyncDoors}
            disabled={syncingDoors}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <RefreshIcon spinning={syncingDoors} />
            <span>{syncingDoors ? 'Scanning UniFi Access…' : 'Scan for Doors Now'}</span>
          </button>
        </div>
      ) : filteredDoors.length === 0 ? (
        <div className="card empty-state" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
          <p className="empty-state-title">No doors match your filter</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
            Try resetting your campus, location, or search filter.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setSelectedCampusFilter('all'); setSelectedLocationFilter('all'); setSearchQuery(''); }}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3">
          {filteredDoors.map((door) => (
            <DoorCard
              key={door.id}
              door={door}
              schedules={schedules}
              scheduleWindows={scheduleWindows}
              onUnlock={openUnlockModal}
              onLock={openLockModal}
              onEditCampusLocation={openAssignModalForSingle}
              selected={selectedDoorIds.includes(door.id)}
              onSelectToggle={handleDoorSelectToggle}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}

      {/* Agent Status */}
      <section className="section" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.75rem' }}>
          Agent Status
        </h2>
        <div className="card" style={{ padding: '0 1.5rem' }}>
          {agents.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem 0' }}>
              <p className="empty-state-title">No agents registered</p>
              <p style={{ fontSize: '0.875rem' }}>
                Deploy the local agent and configure it with your org credentials.
              </p>
            </div>
          ) : (
            agents.map((agent) => <AgentStatusRow key={agent.id} agent={agent} latestVersion={latestRelease?.version ?? null} />)
          )}
        </div>
      </section>

      {/* Assign Campus & Location Modal */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => !assigning && setAssignModalOpen(false)}
        title={doorsToAssign.length === 1 ? `Map Location: ${doorsToAssign[0]?.label}` : `Map ${doorsToAssign.length} Doors to Campus & Location`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', width: '100%' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setAssignModalOpen(false)}
              disabled={assigning}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveAssign}
              disabled={assigning}
            >
              {assigning ? 'Saving Mapping…' : 'Save Door Mapping'}
            </button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: 0 }}>
            Assigning physical campuses and rooms from Planning Center simplifies access scheduling, filterable door lists, and multi-site access control.
          </p>

          {/* Selected Doors List */}
          {doorsToAssign.length > 1 && (
            <div style={{ padding: '0.625rem', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: '0.75rem', maxHeight: '5rem', overflowY: 'auto' }}>
              <strong>Applying to:</strong> {doorsToAssign.map((d) => d.label).join(', ')}
            </div>
          )}

          {/* Campus Selector */}
          <div>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.375rem', display: 'block' }}>
              Planning Center Campus
            </label>
            <select
              className="input"
              value={targetCampusId}
              onChange={(e) => setTargetCampusId(e.target.value)}
              disabled={assigning}
            >
              <option value="">No Campus (Unassigned)</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  🏫 {c.name} {c.city ? `(${c.city})` : ''}
                </option>
              ))}
              <option value="custom">✏️ Enter Custom Campus Name…</option>
            </select>
          </div>

          {targetCampusId === 'custom' && (
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', display: 'block' }}>
                Custom Campus Name
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. North Campus, Main Sanctuary Building"
                value={customCampusName}
                onChange={(e) => setCustomCampusName(e.target.value)}
                disabled={assigning}
                autoFocus
              />
            </div>
          )}

          {/* Location / Room Selector */}
          <div>
            <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.375rem', display: 'block' }}>
              Location / Room
            </label>
            <select
              className="input"
              value={targetLocationId}
              onChange={(e) => setTargetLocationId(e.target.value)}
              disabled={assigning}
            >
              <option value="">No Specific Room (Whole Campus / Exterior)</option>
              {locations
                .filter((l) => !targetCampusId || targetCampusId === 'custom' || !l.campus_id || l.campus_id === targetCampusId)
                .map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    📍 {loc.name} {loc.kind ? `(${loc.kind})` : ''}
                  </option>
                ))}
              <option value="custom">✏️ Enter Custom Room / Location Name…</option>
            </select>
          </div>

          {targetLocationId === 'custom' && (
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', display: 'block' }}>
                Custom Room / Location Name
              </label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Youth Auditorium, Nursery Room 102, Worship Stage"
                value={customLocationName}
                onChange={(e) => setCustomLocationName(e.target.value)}
                disabled={assigning}
              />
            </div>
          )}
        </div>
      </Modal>

      {/* Unlock Modal */}
      <Modal
        isOpen={unlockModalOpen}
        onClose={() => !actionLoading && setUnlockModalOpen(false)}
        title={`Unlock: ${selectedDoor?.label}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setUnlockModalOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </button>
            <button
              className="btn btn-success"
              onClick={handleUnlockConfirm}
              disabled={actionLoading}
            >
              {actionLoading ? 'Sending…' : `Unlock for ${unlockDuration} min`}
            </button>
          </div>
        }
      >
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label className="form-label">
            Unlock Duration: <strong>{unlockDuration} minutes</strong>
          </label>
          <input
            type="range"
            min={1}
            max={480}
            step={5}
            value={unlockDuration}
            onChange={(e) => setUnlockDuration(Number(e.target.value))}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            <span>1 min</span>
            <span>8 hours</span>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Exact Duration (minutes)</label>
          <input
            type="number"
            className="form-input"
            min={1}
            max={480}
            value={unlockDuration}
            onChange={(e) => setUnlockDuration(Math.max(1, Math.min(480, Number(e.target.value))))}
          />
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          The door will automatically relock after the selected duration. This is a manual override and will be logged in the audit trail.
        </p>
      </Modal>

      {/* Lock Confirmation Modal */}
      <Modal
        isOpen={lockModalOpen}
        onClose={() => !actionLoading && setLockModalOpen(false)}
        title={`Lock: ${lockDoor?.label}`}
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setLockModalOpen(false)}
              disabled={actionLoading}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={handleLockConfirm}
              disabled={actionLoading}
            >
              {actionLoading ? 'Sending…' : 'Lock Now'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem' }}>
          Are you sure you want to immediately lock{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{lockDoor?.label}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          This will override any active schedule window. The action will be recorded in the audit log.
        </p>
      </Modal>

      <style>{`
        @media (max-width: 900px) {
          .grid-cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 580px) {
          .grid-cols-3 { grid-template-columns: repeat(1, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
}

