'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type {
  UnifiSchedule,
  UnifiWeeklyScheduleDay,
  UnifiScheduleTimeSlot,
  DayOfWeek,
  Door,
} from '@/lib/types';

interface UnifiScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  schedule?: UnifiSchedule | null;
  doors: Door[];
  onSaved?: () => void;
}

const DAYS: { key: DayOfWeek; label: string; short: string }[] = [
  { key: 'monday', label: 'Monday', short: 'Mon' },
  { key: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday', label: 'Thursday', short: 'Thu' },
  { key: 'friday', label: 'Friday', short: 'Fri' },
  { key: 'saturday', label: 'Saturday', short: 'Sat' },
  { key: 'sunday', label: 'Sunday', short: 'Sun' },
];

function defaultWeeklySchedule(): UnifiWeeklyScheduleDay[] {
  return DAYS.map(({ key }) => ({
    day: key,
    active: key !== 'saturday' && key !== 'sunday',
    slots: [{ start_time: '08:00', end_time: '17:00' }],
  }));
}

export default function UnifiScheduleModal({
  isOpen,
  onClose,
  orgId,
  schedule,
  doors,
  onSaved,
}: UnifiScheduleModalProps) {
  const isEditing = Boolean(schedule?.id);

  const [name, setName] = useState('');
  const [type, setType] = useState<'unlock' | 'access'>('unlock');
  const [weeklySchedule, setWeeklySchedule] = useState<UnifiWeeklyScheduleDay[]>(defaultWeeklySchedule());
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (schedule) {
      setName(schedule.name || '');
      setType(schedule.type === 'access' ? 'access' : 'unlock');
      setSelectedDoorIds(schedule.door_ids || []);

      if (schedule.weekly_schedule && schedule.weekly_schedule.length > 0) {
        const merged = DAYS.map(({ key }) => {
          const found = schedule.weekly_schedule.find((d) => d.day === key);
          if (found) {
            const active = found.active !== false && found.slots && found.slots.length > 0;
            const slots = found.slots && found.slots.length > 0
              ? found.slots.map((s) => ({
                  start_time: s.start_time || '08:00',
                  end_time: s.end_time || '17:00',
                }))
              : [{ start_time: '08:00', end_time: '17:00' }];
            return {
              day: key,
              active,
              slots,
            };
          }
          return {
            day: key,
            active: false,
            slots: [{ start_time: '08:00', end_time: '17:00' }],
          };
        });
        setWeeklySchedule(merged);
      } else {
        setWeeklySchedule(defaultWeeklySchedule());
      }
    } else {
      setName('');
      setType('unlock');
      setWeeklySchedule(defaultWeeklySchedule());
      setSelectedDoorIds([]);
    }
    setError(null);
  }, [schedule, isOpen]);

  const handleDayToggle = (day: DayOfWeek) => {
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const nextActive = !d.active;
        return {
          ...d,
          active: nextActive,
          slots: d.slots.length > 0 ? d.slots : [{ start_time: '08:00', end_time: '17:00' }],
        };
      })
    );
  };

  const handleSlotTimeChange = (
    day: DayOfWeek,
    slotIndex: number,
    field: 'start_time' | 'end_time',
    value: string
  ) => {
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const nextSlots = d.slots.map((s, idx) => {
          if (idx !== slotIndex) return s;
          return { ...s, [field]: value };
        });
        return { ...d, slots: nextSlots };
      })
    );
  };

  const handleAddSlot = (day: DayOfWeek) => {
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const lastSlot = d.slots[d.slots.length - 1];
        let nextStart = '18:00';
        let nextEnd = '21:00';

        if (lastSlot) {
          const [lastEndH] = lastSlot.end_time.split(':').map((n) => parseInt(n, 10));
          if (!isNaN(lastEndH) && lastEndH < 22) {
            const startH = Math.min(lastEndH + 1, 22);
            const endH = Math.min(startH + 3, 23);
            nextStart = `${String(startH).padStart(2, '0')}:00`;
            nextEnd = `${String(endH).padStart(2, '0')}:00`;
          }
        }

        const newSlot: UnifiScheduleTimeSlot = {
          start_time: nextStart,
          end_time: nextEnd,
        };

        return {
          ...d,
          active: true,
          slots: [...d.slots, newSlot],
        };
      })
    );
  };

  const handleRemoveSlot = (day: DayOfWeek, slotIndex: number) => {
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const remaining = d.slots.filter((_, idx) => idx !== slotIndex);
        return {
          ...d,
          active: remaining.length > 0,
          slots: remaining.length > 0 ? remaining : [{ start_time: '08:00', end_time: '17:00' }],
        };
      })
    );
  };

  const copyMondayToWeekdays = () => {
    const monday = weeklySchedule.find((d) => d.day === 'monday');
    const mondaySlots = monday?.slots || [{ start_time: '08:00', end_time: '17:00' }];
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d.day)) {
          return {
            ...d,
            active: monday?.active ?? true,
            slots: mondaySlots.map((s) => ({ ...s })),
          };
        }
        return d;
      })
    );
  };

  const copyToAllActiveDays = (sourceDay: DayOfWeek) => {
    const source = weeklySchedule.find((d) => d.day === sourceDay);
    if (!source || source.slots.length === 0) return;
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.active) {
          return {
            ...d,
            slots: source.slots.map((s) => ({ ...s })),
          };
        }
        return d;
      })
    );
  };

  const handleDoorToggle = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Schedule name is required.');
      return;
    }

    // Validate times & non-overlapping intervals
    for (const d of weeklySchedule) {
      if (!d.active) continue;
      const dayLabel = DAYS.find((item) => item.key === d.day)?.label || d.day;

      if (!d.slots || d.slots.length === 0) {
        setError(`Please add at least one time window for ${dayLabel}, or turn off ${dayLabel}.`);
        return;
      }

      for (let i = 0; i < d.slots.length; i++) {
        const slot = d.slots[i];
        if (!slot.start_time || !slot.end_time) {
          setError(`Please provide both start and end times for ${dayLabel} (Window #${i + 1}).`);
          return;
        }

        if (slot.start_time >= slot.end_time) {
          setError(
            `On ${dayLabel}, Window #${i + 1} start time (${slot.start_time}) must be earlier than end time (${slot.end_time}).`
          );
          return;
        }
      }

      // Check for overlaps among multiple slots
      for (let i = 0; i < d.slots.length; i++) {
        for (let j = i + 1; j < d.slots.length; j++) {
          const slotA = d.slots[i];
          const slotB = d.slots[j];
          if (slotA.start_time < slotB.end_time && slotB.start_time < slotA.end_time) {
            setError(
              `On ${dayLabel}, Window #${i + 1} (${slotA.start_time}–${slotA.end_time}) and Window #${j + 1} (${slotB.start_time}–${slotB.end_time}) overlap. Time windows must not overlap.`
            );
            return;
          }
        }
      }
    }

    setSaving(true);
    setError(null);

    const doorLabels = doors
      .filter((d) => selectedDoorIds.includes(d.id || d.unifi_door_id))
      .map((d) => d.label);

    const payload: Partial<UnifiSchedule> = {
      id: schedule?.id,
      name: name.trim(),
      type,
      weekly_schedule: weeklySchedule,
      door_ids: selectedDoorIds,
      door_labels: doorLabels,
      raw_data: schedule?.raw_data,
    };

    try {
      const fn = httpsCallable(functions, 'saveUnifiSchedule');
      await fn({ orgId, schedule: payload });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!schedule?.id) return;
    if (!confirm(`Are you sure you want to delete "${schedule.name}" from UniFi Access?`)) return;

    setDeleting(true);
    setError(null);

    try {
      const fn = httpsCallable(functions, 'deleteUnifiSchedule');
      await fn({ orgId, scheduleId: schedule.id });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete schedule.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit UniFi Schedule: ${schedule?.name}` : 'New UniFi Schedule'}
      maxWidth="42rem"
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          {isEditing ? (
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-danger)' }}
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? 'Deleting…' : 'Delete Schedule'}
            </button>
          ) : <div />}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving || deleting}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || deleting}>
              {saving ? 'Saving to UniFi…' : 'Save to UniFi'}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && <div className="alert alert-danger">{error}</div>}

        {/* Name & Type */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 14rem' }}>
            <label className="form-label" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Schedule Name *
            </label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Normal Business Hours, Sunday Services, Youth Night"
              required
            />
          </div>

          <div style={{ flex: '1 1 10rem' }}>
            <label className="form-label" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
              Schedule Type
            </label>
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value as 'unlock' | 'access')}
            >
              <option value="unlock">Door Unlock Schedule</option>
              <option value="access">Access Policy Schedule</option>
            </select>
          </div>
        </div>

        {/* Weekly Hours & Multi-Time-Slot Editor */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.8125rem', fontWeight: 600, margin: 0 }}>
                Weekly Unlock Windows
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'block' }}>
                Add multiple open/unlock windows per day (e.g., Morning 8am–12pm & Evening 5pm–9pm)
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={copyMondayToWeekdays}
              style={{ fontSize: '0.75rem', color: 'var(--color-accent)' }}
              title="Copy Monday's windows to Tuesday through Friday"
            >
              Copy Mon to Weekdays
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.625rem',
              background: 'var(--color-bg-base)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
            }}
          >
            {DAYS.map(({ key, label }) => {
              const dayConfig = weeklySchedule.find((d) => d.day === key);
              const isActive = dayConfig?.active ?? false;
              const slots = dayConfig?.slots || [{ start_time: '08:00', end_time: '17:00' }];

              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                    padding: '0.5rem 0.625rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-bg-surface)' : 'transparent',
                    border: isActive ? '1px solid var(--color-border)' : '1px solid transparent',
                  }}
                >
                  {/* Day Header Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        userSelect: 'none',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => handleDayToggle(key)}
                      />
                      <span>{label}</span>
                      {isActive && (
                        <span
                          className="badge badge-neutral"
                          style={{ fontSize: '0.6875rem', padding: '0.1rem 0.35rem' }}
                        >
                          {slots.length} {slots.length === 1 ? 'window' : 'windows'}
                        </span>
                      )}
                    </label>

                    {isActive && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => handleAddSlot(key)}
                          style={{
                            fontSize: '0.6875rem',
                            padding: '0.15rem 0.4rem',
                            color: 'var(--color-accent)',
                          }}
                          title={`Add another open window to ${label}`}
                        >
                          + Add Window
                        </button>
                        {slots.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => copyToAllActiveDays(key)}
                            style={{
                              fontSize: '0.6875rem',
                              padding: '0.15rem 0.4rem',
                              color: 'var(--color-text-muted)',
                            }}
                            title={`Copy ${label}'s windows to all active days`}
                          >
                            Apply to All
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Time Slots List */}
                  {isActive ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.25rem', paddingLeft: '1.75rem' }}>
                      {slots.map((slot, sIdx) => (
                        <div
                          key={sIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--color-text-muted)',
                              width: '4.25rem',
                            }}
                          >
                            Window #{sIdx + 1}:
                          </span>

                          <input
                            type="time"
                            className="form-input form-input-sm"
                            style={{ width: '8.25rem', padding: '0.25rem 0.5rem' }}
                            value={slot.start_time}
                            onChange={(e) => handleSlotTimeChange(key, sIdx, 'start_time', e.target.value)}
                          />
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>to</span>
                          <input
                            type="time"
                            className="form-input form-input-sm"
                            style={{ width: '8.25rem', padding: '0.25rem 0.5rem' }}
                            value={slot.end_time}
                            onChange={(e) => handleSlotTimeChange(key, sIdx, 'end_time', e.target.value)}
                          />

                          {slots.length > 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => handleRemoveSlot(key, sIdx)}
                              style={{
                                color: 'var(--color-danger)',
                                padding: '0.2rem 0.4rem',
                                fontSize: '0.75rem',
                              }}
                              title="Remove this time window"
                            >
                              ✕ Remove
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ paddingLeft: '1.75rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        Closed / Locked 24 hours
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Assigned Doors */}
        <div>
          <label className="form-label" style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Assigned Doors ({selectedDoorIds.length} selected)
          </label>
          {doors.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              No doors found. Ensure your UniFi Access doors are synced.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))',
                gap: '0.5rem',
                maxHeight: '9rem',
                overflowY: 'auto',
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-base)',
              }}
            >
              {doors.map((door) => {
                const doorKey = door.id || door.unifi_door_id;
                const checked = selectedDoorIds.includes(doorKey);
                return (
                  <label
                    key={doorKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.375rem 0.5rem',
                      borderRadius: 'var(--radius-sm)',
                      background: checked ? 'rgba(36, 101, 245, 0.08)' : 'var(--color-bg-surface)',
                      border: `1px solid ${checked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleDoorToggle(doorKey)}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {door.label}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
