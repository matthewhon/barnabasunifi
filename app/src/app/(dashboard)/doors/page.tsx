'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import {
  subscribeToDoors,
  subscribeToAgents,
  subscribeToUnifiSchedules,
  createDoorCommand,
  getLatestAgentRelease,
  approveAgentUpdate,
  setAgentAutoUpdate,
} from '@/lib/firestore';
import type { Door, Agent, UnifiSchedule, AgentRelease } from '@/lib/types';
import { safeFormatDistanceToNow } from '@/lib/date-utils';
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

// ─── Door Card ────────────────────────────────────────────────────────────────

interface DoorCardProps {
  door: Door;
  schedules?: UnifiSchedule[];
  onUnlock: (door: Door) => void;
  onLock: (door: Door) => void;
  actionLoading: boolean;
}

function DoorCard({ door, schedules = [], onUnlock, onLock, actionLoading }: DoorCardProps) {
  const isLocked = door.current_state === 'locked';
  const isUnknown = door.current_state === 'unknown';

  const assignedSchedules = schedules.filter((s) => {
    const doorId = door.id;
    const unifiDoorId = door.unifi_door_id;
    return s.door_ids?.includes(doorId) || (unifiDoorId && s.door_ids?.includes(unifiDoorId));
  });

  const borderColor = isUnknown
    ? 'var(--color-border)'
    : isLocked
    ? 'rgba(239,68,68,0.35)'
    : 'rgba(34,197,94,0.35)';

  return (
    <div
      className="card"
      style={{
        borderColor,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ minWidth: 0 }}>
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
        <div style={{ flexShrink: 0, marginTop: '0.125rem' }}>
          {isUnknown ? (
            <LockIcon color="var(--color-text-muted)" />
          ) : isLocked ? (
            <LockIcon color="var(--color-danger)" />
          ) : (
            <UnlockIcon color="var(--color-success)" />
          )}
        </div>
      </div>

      {/* State & Schedule badges */}
      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span
          className={`badge ${
            isUnknown ? 'badge-neutral' : isLocked ? 'badge-danger' : 'badge-success'
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

        {door.is_held_unlocked && (
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
              title={`Assigned to UniFi schedule: ${s.name}`}
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
                🗓️ {s.name}
              </span>
            </Link>
          ))
        ) : (door.schedule_name || door.unlock_schedule_name) ? (
          <Link
            href="/schedule"
            style={{ textDecoration: 'none' }}
            title={`Assigned door schedule: ${door.schedule_name || door.unlock_schedule_name}`}
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
              🗓️ {door.schedule_name || door.unlock_schedule_name}
            </span>
          </Link>
        ) : null}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
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
  const isOutdated = Boolean(targetVersion && agent.version && agent.version !== targetVersion);
  const [approving, setApproving] = useState(false);
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
        }}
      >
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
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {agent.label}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              v{agent.version}
            </span>
            {isOutdated && (
              <span
                className="badge badge-warning"
                style={{ fontSize: '0.6875rem', fontWeight: 600 }}
              >
                Update: v{targetVersion}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
            Capabilities: {agent.capabilities?.join(', ') || 'door management'}
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
              {approving ? 'Approving…' : `🚀 Approve & Deploy v${targetVersion}`}
            </button>
          )}

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
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [latestRelease, setLatestRelease] = useState<AgentRelease | null>(null);

  // Unlock modal state
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [selectedDoor, setSelectedDoor] = useState<Door | null>(null);
  const [unlockDuration, setUnlockDuration] = useState(30);

  // Confirmation modal for lock
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockDoor, setLockDoor] = useState<Door | null>(null);

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

    // Fetch latest release for version comparison
    getLatestAgentRelease().then((r) => setLatestRelease(r)).catch(() => {});

    return () => {
      unsubDoors();
      unsubAgents();
      unsubSchedules();
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

  const onlineAgents = agents.filter((a) => a.status === 'online').length;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1 className="page-title">Doors</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            <ServerIcon />
            <span>
              {onlineAgents}/{agents.length} agent{agents.length !== 1 ? 's' : ''} online
            </span>
          </div>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: '1.5rem' }}
        >
          {feedback.message}
        </div>
      )}

      {/* Door Grid */}
      {loading ? (
        <div className="grid grid-cols-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card skeleton" style={{ height: '10rem' }} />
          ))}
        </div>
      ) : doors.length === 0 ? (
        <div className="card empty-state">
          <p className="empty-state-title">No doors found</p>
          <p style={{ fontSize: '0.875rem' }}>
            The local UniFi agent will populate doors automatically once it comes online.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3">
          {doors.map((door) => (
            <DoorCard
              key={door.id}
              door={door}
              schedules={schedules}
              onUnlock={openUnlockModal}
              onLock={openLockModal}
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
