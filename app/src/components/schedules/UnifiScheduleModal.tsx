'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type {
  UnifiSchedule,
  UnifiWeeklyScheduleDay,
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
        // Ensure all 7 days exist
        const merged = DAYS.map(({ key }) => {
          const found = schedule.weekly_schedule.find((d) => d.day === key);
          if (found) {
            return {
              day: key,
              active: found.active !== false && found.slots.length > 0,
              slots: found.slots.length > 0 ? found.slots : [{ start_time: '08:00', end_time: '17:00' }],
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
      prev.map((d) => (d.day === day ? { ...d, active: !d.active } : d))
    );
  };

  const handleTimeChange = (day: DayOfWeek, field: 'start_time' | 'end_time', value: string) => {
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (d.day !== day) return d;
        const currentSlot = d.slots[0] || { start_time: '08:00', end_time: '17:00' };
        return {
          ...d,
          slots: [{ ...currentSlot, [field]: value }],
        };
      })
    );
  };

  const copyMondayToWeekdays = () => {
    const monday = weeklySchedule.find((d) => d.day === 'monday');
    const slot = monday?.slots[0] || { start_time: '08:00', end_time: '17:00' };
    setWeeklySchedule((prev) =>
      prev.map((d) => {
        if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(d.day)) {
          return {
            ...d,
            active: monday?.active ?? true,
            slots: [{ ...slot }],
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
      maxWidth="38rem"
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
              placeholder="e.g., Normal Business Hours, Weekend Entry"
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

        {/* Weekly Hours */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <label className="form-label" style={{ fontSize: '0.8125rem', fontWeight: 600, margin: 0 }}>
              Weekly Hours & Days
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={copyMondayToWeekdays}
              style={{ fontSize: '0.75rem', color: 'var(--color-accent)' }}
            >
              Copy Mon to Weekdays
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--color-bg-base)', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            {DAYS.map(({ key, label }) => {
              const dayConfig = weeklySchedule.find((d) => d.day === key);
              const isActive = dayConfig?.active ?? false;
              const slot = dayConfig?.slots[0] || { start_time: '08:00', end_time: '17:00' };

              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.375rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-bg-surface)' : 'transparent',
                    border: isActive ? '1px solid var(--color-border)' : '1px solid transparent',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      width: '7.5rem',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => handleDayToggle(key)}
                    />
                    {label}
                  </label>

                  {isActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      <input
                        type="time"
                        className="form-input form-input-sm"
                        style={{ width: '8.5rem', padding: '0.25rem 0.5rem' }}
                        value={slot.start_time}
                        onChange={(e) => handleTimeChange(key, 'start_time', e.target.value)}
                      />
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>to</span>
                      <input
                        type="time"
                        className="form-input form-input-sm"
                        style={{ width: '8.5rem', padding: '0.25rem 0.5rem' }}
                        value={slot.end_time}
                        onChange={(e) => handleTimeChange(key, 'end_time', e.target.value)}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      Closed / Locked
                    </span>
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
