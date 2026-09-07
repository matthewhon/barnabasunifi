'use client';

import React, { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type {
  UnifiAccessPolicy,
  UnifiSchedule,
  Door,
} from '@/lib/types';

interface AccessPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  policy?: UnifiAccessPolicy | null;
  doors: Door[];
  schedules: UnifiSchedule[];
  onSaved?: () => void;
}

export default function AccessPolicyModal({
  isOpen,
  onClose,
  orgId,
  policy,
  doors,
  schedules,
  onSaved,
}: AccessPolicyModalProps) {
  const isEditing = Boolean(policy?.id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleId, setScheduleId] = useState<string>('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [doorSearch, setDoorSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper to filter out raw UUID ghost doors
  const isUuid = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());

  const validDoors = doors.filter((d) => {
    const label = (d.label || '').trim();
    if (!label) return false;
    if (isUuid(label) && d.current_state === 'unknown') return false;
    return true;
  });

  const filteredDoors = validDoors.filter((d) => {
    if (!doorSearch.trim()) return true;
    const q = doorSearch.toLowerCase();
    return (
      (d.label && d.label.toLowerCase().includes(q)) ||
      (d.floor && d.floor.toLowerCase().includes(q)) ||
      (d.building && d.building.toLowerCase().includes(q))
    );
  });

  useEffect(() => {
    if (policy) {
      setName(policy.name || '');
      setDescription(policy.description || '');
      setScheduleId(policy.schedule_id || '');
      setSelectedDoorIds(policy.door_ids || []);
    } else {
      setName('');
      setDescription('');
      setScheduleId('');
      setSelectedDoorIds([]);
    }
    setDoorSearch('');
    setError(null);
  }, [policy, isOpen]);

  const handleDoorToggle = (doorId: string) => {
    setSelectedDoorIds((prev) =>
      prev.includes(doorId) ? prev.filter((id) => id !== doorId) : [...prev, doorId]
    );
  };

  const handleSelectAllDoors = () => {
    const allValidIds = validDoors.map((d) => d.id || d.unifi_door_id);
    setSelectedDoorIds(allValidIds);
  };

  const handleDeselectAllDoors = () => {
    setSelectedDoorIds([]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Access policy name is required.');
      return;
    }
    if (selectedDoorIds.length === 0) {
      setError('Please select at least one door for this access policy.');
      return;
    }

    setSaving(true);
    setError(null);

    const doorLabels = validDoors
      .filter((d) => selectedDoorIds.includes(d.id || d.unifi_door_id))
      .map((d) => (d.label || '').trim() || d.id);

    const selectedSchedule = schedules.find((s) => s.id === scheduleId || s.unifi_schedule_id === scheduleId);

    const payload: Partial<UnifiAccessPolicy> = {
      id: policy?.id,
      unifi_policy_id: policy?.unifi_policy_id,
      name: name.trim(),
      description: description.trim() || undefined,
      door_ids: selectedDoorIds,
      door_labels: doorLabels,
      schedule_id: scheduleId || undefined,
      schedule_name: selectedSchedule?.name || (scheduleId ? 'Custom Schedule' : undefined),
      raw_data: policy?.raw_data,
    };

    try {
      const fn = httpsCallable<{ orgId: string; policy: Partial<UnifiAccessPolicy> }>(
        functions,
        'saveUnifiAccessPolicy'
      );
      await fn({ orgId, policy: payload });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save access policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!policy?.id) return;
    if (!confirm(`Are you sure you want to delete access policy "${policy.name}" from UniFi Access?`)) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const fn = httpsCallable<{ orgId: string; policyId: string; unifiPolicyId?: string }>(
        functions,
        'deleteUnifiAccessPolicy'
      );
      await fn({ orgId, policyId: policy.id, unifiPolicyId: policy.unifi_policy_id });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete access policy.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Access Policy: ${policy?.name}` : 'Create Access Policy'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: 'var(--color-danger, #ef4444)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Policy Name */}
        <div>
          <label className="form-label" style={{ marginBottom: '0.375rem', display: 'block', fontWeight: 600 }}>
            Policy Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Staff 24/7, Volunteers Sunday, Rehearsal Stage Access"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving || deleting}
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="form-label" style={{ marginBottom: '0.375rem', display: 'block' }}>
            Description / Notes (Optional)
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Grants access to rehearsal room and main sanctuary doors"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving || deleting}
          />
        </div>

        {/* Access Schedule Selector */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
            <label className="form-label" style={{ marginBottom: 0, fontWeight: 600 }}>
              Access Schedule
            </label>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Controls unlock permissions window
            </span>
          </div>
          <select
            className="input"
            value={scheduleId}
            onChange={(e) => setScheduleId(e.target.value)}
            disabled={saving || deleting}
          >
            <option value="">Always Access (24/7 Default)</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.type ? `(${s.type})` : ''}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            When assigned to users, this policy unlocks doors during the schedule's active time windows.
          </p>
        </div>

        {/* Door Selection */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '0.5rem',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <label className="form-label" style={{ marginBottom: 0, fontWeight: 600 }}>
              Assigned Doors ({selectedDoorIds.length} of {validDoors.length} selected){' '}
              <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                onClick={handleSelectAllDoors}
                disabled={saving || deleting}
              >
                Select All
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
                onClick={handleDeselectAllDoors}
                disabled={saving || deleting}
              >
                Clear
              </button>
            </div>
          </div>

          {validDoors.length > 6 && (
            <input
              type="text"
              className="input"
              placeholder="Filter doors…"
              value={doorSearch}
              onChange={(e) => setDoorSearch(e.target.value)}
              style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
            />
          )}

          {validDoors.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              No doors found. Ensure your UniFi Access Agent is connected.
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.375rem',
                maxHeight: '14rem',
                overflowY: 'auto',
                padding: '0.25rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-base)',
                border: '1px solid var(--color-border)',
              }}
            >
              {filteredDoors.map((door) => {
                const isSelected = selectedDoorIds.includes(door.id || door.unifi_door_id);
                return (
                  <label
                    key={door.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      padding: '0.5rem 0.625rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(36,101,245,0.1)' : 'var(--color-bg-surface)',
                      border: `1px solid ${isSelected ? 'rgba(36,101,245,0.35)' : 'transparent'}`,
                      transition: 'all 0.15s ease',
                      fontSize: '0.875rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleDoorToggle(door.id || door.unifi_door_id)}
                      disabled={saving || deleting}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontWeight: isSelected ? 600 : 400, color: 'var(--color-text-primary)' }}>
                        {door.label || door.id}
                      </span>
                      {(door.building || door.floor) && (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                          {[door.building, door.floor].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    <span
                      className={`badge ${
                        door.current_state === 'locked'
                          ? 'badge-danger'
                          : door.current_state === 'unlocked'
                          ? 'badge-success'
                          : 'badge-neutral'
                      }`}
                      style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}
                    >
                      {door.current_state}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--color-border)',
            paddingTop: '1rem',
            marginTop: '0.5rem',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          {isEditing ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Policy'}
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={saving || deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || deleting || validDoors.length === 0}
            >
              {saving ? 'Saving…' : isEditing ? 'Update Policy' : 'Create Policy'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
