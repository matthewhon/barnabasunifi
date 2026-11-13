'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToDoors,
  subscribeToScheduleWindows,
  subscribeToUnifiSchedules,
  subscribeToRecentCommands,
  subscribeToCampuses,
  createDoorCommand,
} from '@/lib/firestore';
import type {
  Door,
  DoorCommand,
  PcoCampus,
  ScheduleWindow,
  UnifiSchedule,
} from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { getDoorUnlockStatus } from '@/lib/door-status-utils';
import { useToast } from '@/components/ui/Toast';
import MobileDialog from '@/components/mobile/MobileDialog';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  Clock,
  DoorOpen,
  Lock,
  MapPin,
  Search,
  ShieldAlert,
  Unlock,
} from 'lucide-react';

const DURATION_OPTIONS = [
  { label: '1 min', sub: 'Quick entry', value: 1 },
  { label: '5 min', sub: 'Short', value: 5 },
  { label: '15 min', sub: 'Standard', value: 15 },
  { label: '30 min', sub: 'Half hour', value: 30 },
  { label: '1 hour', sub: '60 min', value: 60 },
  { label: '2 hours', sub: 'Extended', value: 120 },
  { label: 'Hold Open', sub: 'Until locked', value: 0 },
] as const;

export default function MobileDoorsPage() {
  const { orgId, user } = useAuth();
  const { showToast } = useToast();

  const [doors, setDoors] = useState<Door[]>([]);
  const [schedules, setSchedules] = useState<UnifiSchedule[]>([]);
  const [scheduleWindows, setScheduleWindows] = useState<ScheduleWindow[]>([]);
  const [recentCommands, setRecentCommands] = useState<DoorCommand[]>([]);
  const [campuses, setCampuses] = useState<PcoCampus[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unlocked' | 'locked'>('all');
  const [campusFilter, setCampusFilter] = useState<string>('all');

  // Unlock modal state
  const [unlockTarget, setUnlockTarget] = useState<Door | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(15);
  const [submitting, setSubmitting] = useState(false);

  // Lock confirmation modal state
  const [lockTarget, setLockTarget] = useState<Door | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    let firstLoad = true;

    const unsubDoors = subscribeToDoors(orgId, (list) => {
      setDoors(list);
      if (firstLoad) {
        firstLoad = false;
        setLoading(false);
      }
    });
    const unsubWindows = subscribeToScheduleWindows(orgId, setScheduleWindows);
    const unsubSchedules = subscribeToUnifiSchedules(orgId, setSchedules);
    const unsubCommands = subscribeToRecentCommands(orgId, setRecentCommands, 25);
    const unsubCampuses = subscribeToCampuses(orgId, setCampuses);

    return () => {
      unsubDoors();
      unsubWindows();
      unsubSchedules();
      unsubCommands();
      unsubCampuses();
    };
  }, [orgId]);

  const visibleDoors = useMemo(
    () => doors.filter((d) => !isDoorHidden(d)),
    [doors]
  );

  const campusNames = useMemo(() => {
    const names = new Set<string>();
    campuses.forEach((c) => {
      if (c.name) names.add(c.name);
    });
    visibleDoors.forEach((d) => {
      if (d.campus_name) names.add(d.campus_name);
    });
    return Array.from(names).sort();
  }, [campuses, visibleDoors]);

  const counts = useMemo(() => {
    let unlocked = 0;
    let locked = 0;
    for (const d of visibleDoors) {
      if (d.current_state === 'unlocked') unlocked++;
      else if (d.current_state === 'locked') locked++;
    }
    return { total: visibleDoors.length, unlocked, locked };
  }, [visibleDoors]);

  const filteredDoors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleDoors.filter((door) => {
      if (statusFilter === 'unlocked' && door.current_state !== 'unlocked') return false;
      if (statusFilter === 'locked' && door.current_state !== 'locked') return false;
      if (campusFilter !== 'all' && door.campus_name !== campusFilter) return false;
      if (q) {
        const hay = `${door.label} ${door.campus_name ?? ''} ${door.location_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [visibleDoors, statusFilter, campusFilter, search]);

  const pendingCommandByDoor = useMemo(() => {
    const map = new Map<string, DoorCommand>();
    for (const cmd of recentCommands) {
      if (!cmd.door_id) continue;
      if (cmd.status === 'queued' || cmd.status === 'executing') {
        if (!map.has(cmd.door_id)) {
          map.set(cmd.door_id, cmd);
        }
      }
    }
    return map;
  }, [recentCommands]);

  const handleUnlockConfirm = async () => {
    if (!orgId || !user || !unlockTarget) return;
    setSubmitting(true);
    try {
      await createDoorCommand(orgId, {
        org_id: orgId,
        door_id: unlockTarget.id,
        unifi_door_id: unlockTarget.unifi_door_id || unlockTarget.id,
        door_label: unlockTarget.label,
        action: 'unlock',
        execute_at: new Date().toISOString(),
        duration_min: selectedDuration,
        triggered_by: 'manual',
        actor_uid: user.uid,
        status: 'queued',
      });
      showToast(
        selectedDuration === 0
          ? `Hold-open command sent for ${unlockTarget.label}`
          : `Unlock (${selectedDuration}m) sent for ${unlockTarget.label}`,
        'success'
      );
      setUnlockTarget(null);
    } catch {
      showToast('Failed to send unlock command. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLockConfirm = async () => {
    if (!orgId || !user || !lockTarget) return;
    setSubmitting(true);
    try {
      await createDoorCommand(orgId, {
        org_id: orgId,
        door_id: lockTarget.id,
        unifi_door_id: lockTarget.unifi_door_id || lockTarget.id,
        door_label: lockTarget.label,
        action: 'lock',
        execute_at: new Date().toISOString(),
        triggered_by: 'manual',
        actor_uid: user.uid,
        status: 'queued',
      });
      showToast(`Lock command sent for ${lockTarget.label}`, 'success');
      setLockTarget(null);
    } catch {
      showToast('Failed to send lock command. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Page Title & Quick Summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 700, lineHeight: 1.2 }}>Doors</h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: '0.125rem' }}>
            {counts.unlocked} unlocked · {counts.locked} locked · {counts.total} total
          </p>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search
          size={18}
          style={{
            position: 'absolute',
            left: '0.875rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          aria-label="Search doors"
          placeholder="Search doors or campus…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mobile-input"
          style={{ paddingLeft: '2.625rem' }}
          enterKeyHint="search"
        />
      </div>

      {/* Filter Pills */}
      <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.125rem' }}>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        >
          All ({counts.total})
        </button>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={statusFilter === 'unlocked'}
          onClick={() => setStatusFilter('unlocked')}
        >
          <Unlock size={13} />
          Unlocked ({counts.unlocked})
        </button>
        <button
          type="button"
          className="mobile-pill"
          aria-pressed={statusFilter === 'locked'}
          onClick={() => setStatusFilter('locked')}
        >
          <Lock size={13} />
          Locked ({counts.locked})
        </button>
      </div>

      {campusNames.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.125rem' }}>
          <button
            type="button"
            className="mobile-pill"
            aria-pressed={campusFilter === 'all'}
            onClick={() => setCampusFilter('all')}
          >
            All Campuses
          </button>
          {campusNames.map((name) => (
            <button
              key={name}
              type="button"
              className="mobile-pill"
              aria-pressed={campusFilter === name}
              onClick={() => setCampusFilter(name)}
            >
              <MapPin size={13} />
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Doors List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
          <LoadingSpinner />
        </div>
      ) : filteredDoors.length === 0 ? (
        <div
          style={{
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            padding: '2rem 1.25rem',
            textAlign: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <DoorOpen size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
          <p style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.25rem' }}>
            No doors found
          </p>
          <p style={{ fontSize: '0.8125rem' }}>
            {search || statusFilter !== 'all' || campusFilter !== 'all'
              ? 'Try clearing your search or filters.'
              : 'Doors synced from your UniFi Access agent will appear here.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filteredDoors.map((door) => {
            const statusInfo = getDoorUnlockStatus(door, schedules, scheduleWindows);
            const pendingCmd = pendingCommandByDoor.get(door.id);
            const isUnlocked = statusInfo.isUnlocked;

            return (
              <article
                key={door.id}
                style={{
                  background: 'var(--color-bg-surface)',
                  border: `1px solid ${
                    isUnlocked ? 'rgba(34, 197, 94, 0.35)' : 'var(--color-border)'
                  }`,
                  borderRadius: 'var(--radius-xl)',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.875rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  {/* Thumbnail or Icon */}
                  {door.image_url ? (
                    <img
                      src={door.image_url}
                      alt={door.label}
                      style={{
                        width: '3.25rem',
                        height: '3.25rem',
                        borderRadius: 'var(--radius-lg)',
                        objectFit: 'cover',
                        flexShrink: 0,
                        border: '1px solid var(--color-border)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '3.25rem',
                        height: '3.25rem',
                        borderRadius: 'var(--radius-lg)',
                        background: isUnlocked
                          ? 'rgba(34, 197, 94, 0.14)'
                          : 'rgba(148, 163, 184, 0.1)',
                        color: isUnlocked ? 'var(--color-success)' : 'var(--color-text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isUnlocked ? <Unlock size={22} /> : <Lock size={22} />}
                    </div>
                  )}

                  {/* Door Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      }}
                    >
                      <h2
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: 'var(--color-text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {door.label}
                      </h2>
                      <span
                        className={`badge ${
                          statusInfo.badge.variant === 'success'
                            ? 'badge-success'
                            : statusInfo.badge.variant === 'warning'
                            ? 'badge-warning'
                            : statusInfo.badge.variant === 'danger'
                            ? 'badge-danger'
                            : 'badge-neutral'
                        }`}
                        style={{ flexShrink: 0 }}
                      >
                        {statusInfo.badge.text}
                      </span>
                    </div>

                    {(door.campus_name || door.location_name) && (
                      <div
                        style={{
                          fontSize: '0.8125rem',
                          color: 'var(--color-text-secondary)',
                          marginTop: '0.1875rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                      >
                        <MapPin size={12} />
                        <span>
                          {[door.campus_name, door.location_name].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--color-text-muted)',
                        marginTop: '0.25rem',
                      }}
                    >
                      {pendingCmd
                        ? `Sending ${pendingCmd.action} command (${pendingCmd.status})…`
                        : statusInfo.statusSummary}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '0.625rem' }}>
                  <button
                    type="button"
                    className="mobile-touch-btn"
                    disabled={Boolean(pendingCmd)}
                    onClick={() => {
                      setSelectedDuration(15);
                      setUnlockTarget(door);
                    }}
                    style={{
                      flex: 1,
                      background: isUnlocked
                        ? 'var(--color-bg-elevated)'
                        : 'var(--color-accent)',
                      borderColor: isUnlocked ? 'var(--color-border)' : 'var(--color-accent)',
                      color: isUnlocked ? 'var(--color-text-primary)' : '#ffffff',
                    }}
                  >
                    <Unlock size={17} />
                    <span>{isUnlocked ? 'Extend / Hold' : 'Unlock Door'}</span>
                  </button>

                  {isUnlocked && (
                    <button
                      type="button"
                      className="mobile-touch-btn"
                      disabled={Boolean(pendingCmd)}
                      onClick={() => setLockTarget(door)}
                      style={{
                        flex: 1,
                        background: 'rgba(239, 68, 68, 0.14)',
                        borderColor: 'rgba(239, 68, 68, 0.35)',
                        color: '#fca5a5',
                      }}
                    >
                      <Lock size={17} />
                      <span>Lock Now</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Unlock Duration Dialog */}
      <MobileDialog
        open={Boolean(unlockTarget)}
        onClose={() => {
          if (!submitting) setUnlockTarget(null);
        }}
        title={unlockTarget ? `Unlock ${unlockTarget.label}` : 'Unlock Door'}
        subtitle="Choose how long this door should stay unlocked."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '0.625rem',
            }}
          >
            {DURATION_OPTIONS.map((opt) => {
              const selected = selectedDuration === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedDuration(opt.value)}
                  aria-pressed={selected}
                  style={{
                    minHeight: '3.5rem',
                    padding: '0.625rem 0.75rem',
                    borderRadius: 'var(--radius-lg)',
                    border: `1.5px solid ${
                      selected ? 'var(--color-accent)' : 'var(--color-border)'
                    }`,
                    background: selected
                      ? 'rgba(36, 101, 245, 0.16)'
                      : 'var(--color-bg-base)',
                    color: 'var(--color-text-primary)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: '0.125rem',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{opt.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {opt.sub}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              className="mobile-touch-btn"
              disabled={submitting}
              onClick={() => setUnlockTarget(null)}
              style={{
                flex: 1,
                background: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mobile-touch-btn"
              disabled={submitting}
              onClick={handleUnlockConfirm}
              style={{
                flex: 2,
                background: 'var(--color-success)',
                color: '#052e16',
              }}
            >
              <Clock size={17} />
              <span>
                {submitting
                  ? 'Sending…'
                  : selectedDuration === 0
                  ? 'Hold Door Open'
                  : `Unlock for ${selectedDuration}m`}
              </span>
            </button>
          </div>
        </div>
      </MobileDialog>

      {/* Lock Confirmation Dialog */}
      <MobileDialog
        open={Boolean(lockTarget)}
        onClose={() => {
          if (!submitting) setLockTarget(null);
        }}
        title={lockTarget ? `Lock ${lockTarget.label}?` : 'Lock Door'}
        subtitle="This will immediately lock the door and clear any active manual hold."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div
            className="alert alert-warning"
            style={{ alignItems: 'center', padding: '0.75rem 1rem' }}
          >
            <ShieldAlert size={18} style={{ flexShrink: 0 }} />
            <span>Users outside will need a keycard, mobile tap, or PIN to enter.</span>
          </div>

          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <button
              type="button"
              className="mobile-touch-btn"
              disabled={submitting}
              onClick={() => setLockTarget(null)}
              autoFocus
              style={{
                flex: 1,
                background: 'var(--color-bg-elevated)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mobile-touch-btn"
              disabled={submitting}
              onClick={handleLockConfirm}
              style={{
                flex: 1,
                background: 'var(--color-danger)',
                color: '#ffffff',
              }}
            >
              <Lock size={17} />
              <span>{submitting ? 'Locking…' : 'Lock Now'}</span>
            </button>
          </div>
        </div>
      </MobileDialog>
    </div>
  );
}
