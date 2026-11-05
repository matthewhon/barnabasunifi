'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import Modal from '@/components/ui/Modal';
import type {
  Door,
  DoorTimingConfig,
  LockTimingMode,
  Mapping,
  MappingSourceType,
  OrgSettings,
  PcoGroup,
  PcoServiceType,
  PlanTimeType,
} from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { Toggle } from './ActiveMappingCard';
import {
  ProjectedUnlockTimesPreview,
  formatIsoTimeRange,
  timeTypeBadgeStyle,
} from './ProjectedUnlockTimesPreview';

export interface MappingModalSavePayload {
  source_type: MappingSourceType;
  pco_resource_id: string;
  pco_resource_label: string;
  door_ids: string[];
  door_labels: string[];
  time_types?: PlanTimeType[];
  lock_timing_mode?: LockTimingMode;
  lock_offset_min?: number;
  unlock_offset_min?: number;
  door_timings?: Record<string, DoorTimingConfig>;
  enabled: boolean;
}

export interface MappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** If provided, modal operates in Edit mode for this existing mapping */
  editingMapping?: Mapping | null;
  /** When opening in Edit mode, which section tab to focus */
  initialEditSection?: 'doors' | 'timing';
  /** When creating a new mapping from a 1-click button on a specific PCO resource */
  preselectedResource?: {
    sourceType: MappingSourceType;
    resourceId: string;
    resourceLabel: string;
  } | null;
  defaultSourceType?: MappingSourceType;
  serviceResources: PcoServiceType[];
  groupResources: PcoGroup[];
  doors: Door[];
  pcoError?: string | null;
  orgSettings: OrgSettings | null;
  onSave: (data: MappingModalSavePayload, existingMappingId?: string) => Promise<void>;
  saving: boolean;
}

export function MappingModal({
  isOpen,
  onClose,
  editingMapping,
  initialEditSection = 'doors',
  preselectedResource,
  defaultSourceType = 'service',
  serviceResources,
  groupResources,
  doors,
  pcoError,
  orgSettings,
  onSave,
  saving,
}: MappingModalProps) {
  const { role, isSuperAdmin } = useAuth();
  const isAdmin = role === 'org_admin' || isSuperAdmin;

  const isEditMode = Boolean(editingMapping);

  const [editTab, setEditTab] = useState<'doors' | 'timing'>(initialEditSection);
  const [step, setStep] = useState(1);

  const [sourceType, setSourceType] = useState<MappingSourceType>(defaultSourceType);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [timeTypes, setTimeTypes] = useState<PlanTimeType[]>(['service', 'rehearsal']);
  const [timingChoice, setTimingChoice] = useState<'default' | 'after_start' | 'after_end'>('default');
  const [customUnlockMin, setCustomUnlockMin] = useState(15);
  const [customLockMin, setCustomLockMin] = useState(15);
  const [doorTimings, setDoorTimings] = useState<Record<string, DoorTimingConfig>>({});
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doorSearch, setDoorSearch] = useState('');
  const [selectedCampusFilter, setSelectedCampusFilter] = useState<string>('all');

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setDoorSearch('');
    setSelectedCampusFilter('all');

    if (editingMapping) {
      setEditTab(initialEditSection);
      setSourceType(editingMapping.source_type);
      setSelectedResourceId(editingMapping.pco_resource_id);
      setSelectedDoorIds(editingMapping.door_ids || []);
      setTimeTypes(
        editingMapping.time_types && editingMapping.time_types.length > 0
          ? editingMapping.time_types
          : ['service']
      );
      if (editingMapping.lock_timing_mode) {
        setTimingChoice(editingMapping.lock_timing_mode);
      } else {
        setTimingChoice('default');
      }
      setCustomUnlockMin(editingMapping.unlock_offset_min ?? orgSettings?.unlock_buffer_before_min ?? 15);
      if (editingMapping.lock_offset_min !== undefined) {
        setCustomLockMin(editingMapping.lock_offset_min);
      } else {
        const mode = editingMapping.lock_timing_mode ?? orgSettings?.lock_timing_mode ?? 'after_end';
        setCustomLockMin(
          mode === 'after_start'
            ? (orgSettings?.lock_after_start_min ?? 15)
            : (orgSettings?.lock_buffer_after_min ?? 15)
        );
      }
      setDoorTimings(editingMapping.door_timings ? JSON.parse(JSON.stringify(editingMapping.door_timings)) : {});
      setEnabled(editingMapping.enabled);
    } else if (preselectedResource) {
      setSourceType(preselectedResource.sourceType);
      setSelectedResourceId(preselectedResource.resourceId);
      setSelectedDoorIds([]);
      setTimeTypes(['service', 'rehearsal']);
      setTimingChoice('default');
      setCustomUnlockMin(orgSettings?.unlock_buffer_before_min ?? 15);
      setCustomLockMin(15);
      setDoorTimings({});
      setEnabled(true);
      // Jump directly to Step 2 (Select Doors) since resource is already chosen!
      setStep(2);
    } else {
      setSourceType(defaultSourceType);
      setSelectedResourceId('');
      setSelectedDoorIds([]);
      setTimeTypes(['service', 'rehearsal']);
      setTimingChoice('default');
      setCustomUnlockMin(orgSettings?.unlock_buffer_before_min ?? 15);
      setCustomLockMin(15);
      setDoorTimings({});
      setEnabled(true);
      setStep(1);
    }
  }, [isOpen, editingMapping, initialEditSection, preselectedResource, defaultSourceType, orgSettings]);

  const isUuid = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());

  const validDoors = useMemo(() => {
    return doors.filter((d) => {
      const label = (d.label || '').trim();
      if (!label) return false;
      if (isUuid(label) && d.current_state === 'unknown') return false;
      if (!isAdmin && isDoorHidden(d)) return false;
      return true;
    });
  }, [doors, isAdmin]);

  const campusOptions = useMemo(() => {
    const set = new Set<string>();
    validDoors.forEach((d) => {
      if (d.campus_name) set.add(d.campus_name);
    });
    return Array.from(set).sort();
  }, [validDoors]);

  const filteredDoors = useMemo(() => {
    return validDoors.filter((d) => {
      if (selectedCampusFilter === 'unassigned') {
        if (d.campus_name || d.campus_id) return false;
      } else if (selectedCampusFilter !== 'all') {
        if (d.campus_name !== selectedCampusFilter && d.campus_id !== selectedCampusFilter) return false;
      }

      if (!doorSearch.trim()) return true;
      const q = doorSearch.toLowerCase();
      return (
        (d.label && d.label.toLowerCase().includes(q)) ||
        (d.campus_name && d.campus_name.toLowerCase().includes(q)) ||
        (d.location_name && d.location_name.toLowerCase().includes(q)) ||
        (d.floor && d.floor.toLowerCase().includes(q)) ||
        (d.building && d.building.toLowerCase().includes(q))
      );
    });
  }, [validDoors, selectedCampusFilter, doorSearch]);

  const currentResources: Array<PcoServiceType | PcoGroup> =
    sourceType === 'service' ? serviceResources : groupResources;

  const selectedResource = currentResources.find((r) => r.id === selectedResourceId) || null;
  const resourceLabel =
    selectedResource?.name ||
    editingMapping?.pco_resource_label ||
    preselectedResource?.resourceLabel ||
    selectedResourceId;

  const orgMode = orgSettings?.lock_timing_mode ?? 'after_end';
  const orgUnlock = orgSettings?.unlock_buffer_before_min ?? 15;
  const orgLock =
    orgMode === 'after_start'
      ? (orgSettings?.lock_after_start_min ?? 15)
      : (orgSettings?.lock_buffer_after_min ?? 15);

  const effectiveDefaultUnlock = timingChoice !== 'default' ? customUnlockMin : orgUnlock;

  function toggleDoor(id: string) {
    setSelectedDoorIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  function toggleTimeType(tt: PlanTimeType) {
    setTimeTypes((prev) => (prev.includes(tt) ? prev.filter((t) => t !== tt) : [...prev, tt]));
  }

  function handleSelectAllDoors() {
    setSelectedDoorIds(validDoors.map((d) => d.id));
  }

  function handleSelectCampusDoors(campusName: string) {
    const campusDoorIds = validDoors
      .filter((d) =>
        campusName === 'unassigned'
          ? !d.campus_name && !d.campus_id
          : d.campus_name === campusName || d.campus_id === campusName
      )
      .map((d) => d.id);
    setSelectedDoorIds((prev) => Array.from(new Set([...prev, ...campusDoorIds])));
  }

  function handleDeselectAllDoors() {
    setSelectedDoorIds([]);
  }

  function handleToggleDoorCustom(doorId: string, custom: boolean) {
    setDoorTimings((prev) => {
      const next = { ...prev };
      if (!custom) {
        delete next[doorId];
      } else {
        next[doorId] = {
          lock_timing_mode: 'after_start',
          lock_offset_min: 15,
          unlock_offset_min: effectiveDefaultUnlock,
        };
      }
      return next;
    });
  }

  function handleUpdateDoorTiming(doorId: string, partial: Partial<DoorTimingConfig>) {
    setDoorTimings((prev) => ({
      ...prev,
      [doorId]: {
        ...(prev[doorId] || {
          lock_timing_mode: 'after_start',
          lock_offset_min: 15,
          unlock_offset_min: effectiveDefaultUnlock,
        }),
        ...partial,
      },
    }));
  }

  async function handleSave() {
    setError(null);
    if (!selectedResourceId) {
      setError('Please select a Planning Center resource.');
      return;
    }
    if (selectedDoorIds.length === 0) {
      setError('Please select at least one door.');
      return;
    }
    if (sourceType === 'service' && timeTypes.length === 0) {
      setError('Please select at least one trigger time type (e.g. Service or Rehearsal).');
      return;
    }

    const doorLabels = selectedDoorIds.map((id) => {
      const found = doors.find((d) => d.id === id || d.unifi_door_id === id);
      return found?.label || id;
    });

    const cleanedDoorTimings: Record<string, DoorTimingConfig> = {};
    for (const dId of selectedDoorIds) {
      if (doorTimings[dId]) {
        cleanedDoorTimings[dId] = {
          lock_timing_mode: doorTimings[dId].lock_timing_mode,
          lock_offset_min: doorTimings[dId].lock_offset_min,
          unlock_offset_min: doorTimings[dId].unlock_offset_min,
        };
      }
    }

    try {
      await onSave(
        {
          source_type: sourceType,
          pco_resource_id: selectedResourceId,
          pco_resource_label: resourceLabel,
          door_ids: selectedDoorIds,
          door_labels: doorLabels,
          time_types: sourceType === 'service' ? timeTypes : [],
          lock_timing_mode: timingChoice === 'default' ? undefined : timingChoice,
          lock_offset_min: timingChoice === 'default' ? undefined : customLockMin,
          unlock_offset_min: timingChoice === 'default' ? undefined : customUnlockMin,
          door_timings: Object.keys(cleanedDoorTimings).length > 0 ? cleanedDoorTimings : undefined,
          enabled,
        },
        editingMapping?.id
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to save mapping.');
    }
  }

  // Reusable Door Picker UI
  const renderDoorPicker = () => (
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
        <label className="form-label" style={{ marginBottom: 0, display: 'block', fontWeight: 600 }}>
          Select UniFi Doors ({selectedDoorIds.length} of {validDoors.length} selected)
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {campusOptions.length > 0 && selectedCampusFilter !== 'all' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto', color: 'var(--color-accent)' }}
              onClick={() => handleSelectCampusDoors(selectedCampusFilter)}
            >
              Select All {selectedCampusFilter === 'unassigned' ? 'Unassigned' : selectedCampusFilter}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
            onClick={handleSelectAllDoors}
          >
            Select All
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', height: 'auto' }}
            onClick={handleDeselectAllDoors}
          >
            Clear
          </button>
        </div>
      </div>

      {campusOptions.length > 0 && (
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          <button
            type="button"
            className={`btn btn-sm ${selectedCampusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
            onClick={() => setSelectedCampusFilter('all')}
          >
            All Campuses ({validDoors.length})
          </button>
          {campusOptions.map((c) => {
            const count = validDoors.filter((d) => d.campus_name === c || d.campus_id === c).length;
            return (
              <button
                key={c}
                type="button"
                className={`btn btn-sm ${selectedCampusFilter === c ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
                onClick={() => setSelectedCampusFilter(c)}
              >
                🏫 {c} ({count})
              </button>
            );
          })}
          {validDoors.some((d) => !d.campus_name && !d.campus_id) && (
            <button
              type="button"
              className={`btn btn-sm ${selectedCampusFilter === 'unassigned' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', height: 'auto' }}
              onClick={() => setSelectedCampusFilter('unassigned')}
            >
              Unassigned ({validDoors.filter((d) => !d.campus_name && !d.campus_id).length})
            </button>
          )}
        </div>
      )}

      {validDoors.length > 6 && (
        <input
          type="text"
          className="form-input"
          placeholder="Filter doors by name, campus, location, building…"
          value={doorSearch}
          onChange={(e) => setDoorSearch(e.target.value)}
          style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', padding: '0.375rem 0.625rem' }}
        />
      )}

      {validDoors.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          No doors available. Configure the local agent first.
        </p>
      ) : filteredDoors.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '0.75rem', textAlign: 'center' }}>
          No doors match the selected filter.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '15rem', overflowY: 'auto' }}>
          {filteredDoors.map((door) => {
            const isChecked = selectedDoorIds.includes(door.id) || selectedDoorIds.includes(door.unifi_door_id);
            return (
              <label
                key={door.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  background: isChecked ? 'rgba(36,101,245,0.1)' : 'var(--color-bg-elevated)',
                  border: `1px solid ${isChecked ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                  transition: 'all 0.15s ease',
                  fontSize: '0.875rem',
                }}
              >
                <input type="checkbox" checked={isChecked} onChange={() => toggleDoor(door.id)} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '0.1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <span style={{ color: 'var(--color-text-primary)', fontWeight: isChecked ? 600 : 500 }}>
                      {door.label}
                    </span>
                    {isDoorHidden(door) && (
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.625rem',
                          padding: '0.05rem 0.3rem',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: 'var(--color-danger)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          fontWeight: 600,
                        }}
                      >
                        Hidden
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                    {door.campus_name && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-accent, #2465f5)', fontWeight: 500 }}>
                        🏫 {door.campus_name}
                      </span>
                    )}
                    {door.location_name && (
                      <span style={{ fontSize: '0.6875rem', color: '#9333ea', fontWeight: 500 }}>
                        📍 {door.location_name}
                      </span>
                    )}
                  </div>
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
  );

  // Reusable Time Types Picker
  const renderTimeTypesPicker = () =>
    sourceType === 'service' ? (
      <div style={{ marginTop: '1rem' }}>
        <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
          Trigger Time Types (Which PCO plan times unlock doors?)
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {(['service', 'rehearsal', 'other'] as PlanTimeType[]).map((tt) => (
            <label
              key={tt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.85rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timeTypes.includes(tt) ? 'rgba(36,101,245,0.1)' : 'var(--color-bg-elevated)',
                border: `1px solid ${timeTypes.includes(tt) ? 'rgba(36,101,245,0.35)' : 'var(--color-border)'}`,
                fontSize: '0.875rem',
                fontWeight: timeTypes.includes(tt) ? 600 : 500,
              }}
            >
              <input type="checkbox" checked={timeTypes.includes(tt)} onChange={() => toggleTimeType(tt)} />
              <span style={{ color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>
                {tt === 'service' ? '⛪ Service' : tt === 'rehearsal' ? '🎵 Rehearsal' : '🕒 Other'}
              </span>
            </label>
          ))}
        </div>
      </div>
    ) : null;

  // Reusable Timing & Per-Door Rules Editor
  const renderTimingEditor = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Baseline Timing Rule */}
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
          Baseline Door Locking Rule
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modalTimingChoice"
              value="default"
              checked={timingChoice === 'default'}
              onChange={() => setTimingChoice('default')}
            />
            <span>
              Use Organization Default ({orgMode === 'after_start' ? '🛡️ Security Mode' : '🕒 Standard Mode'} ·{' '}
              {orgMode === 'after_start' ? `+${orgLock}m after start` : `+${orgLock}m after end`}, -{orgUnlock}m before)
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modalTimingChoice"
              value="after_start"
              checked={timingChoice === 'after_start'}
              onChange={() => setTimingChoice('after_start')}
            />
            <span style={{ fontWeight: timingChoice === 'after_start' ? 600 : 400 }}>
              🛡️ Security Mode (Lock shortly after event starts)
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="modalTimingChoice"
              value="after_end"
              checked={timingChoice === 'after_end'}
              onChange={() => setTimingChoice('after_end')}
            />
            <span style={{ fontWeight: timingChoice === 'after_end' ? 600 : 400 }}>
              🕒 Standard Mode (Lock after event concludes)
            </span>
          </label>
        </div>

        {timingChoice !== 'default' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <span>Unlock before start:</span>
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

      {/* Per-Door Timing Overrides */}
      {selectedDoorIds.length > 0 && (
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label className="form-label" style={{ marginBottom: 0, fontWeight: 600, fontSize: '0.8125rem' }}>
              Per-Door Timing Overrides (Optional)
            </label>
            {Object.keys(doorTimings).length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.6875rem', padding: '0.1rem 0.35rem', color: 'var(--color-text-muted)' }}
                onClick={() => setDoorTimings({})}
              >
                Reset All to Baseline
              </button>
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Customize specific doors (e.g. lock side doors 15m after start while keeping main entrance doors open until the end).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '14rem', overflowY: 'auto' }}>
            {selectedDoorIds.map((dId) => {
              const doorObj = doors.find((d) => d.id === dId || d.unifi_door_id === dId);
              const doorLabel = doorObj?.label || (dId.length > 8 ? `Door ${dId.slice(0, 8)}` : dId);
              const isCustom = doorTimings[dId] !== undefined;
              const dTiming = doorTimings[dId] || {};
              const dMode = dTiming.lock_timing_mode ?? 'after_start';
              const dUnlock = dTiming.unlock_offset_min ?? effectiveDefaultUnlock;
              const dLock = dTiming.lock_offset_min ?? 15;

              return (
                <div
                  key={dId}
                  style={{
                    padding: '0.625rem 0.75rem',
                    background: 'var(--color-bg-surface)',
                    border: `1px solid ${isCustom ? 'rgba(36, 101, 245, 0.4)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>
                        {doorLabel}
                      </span>
                      <span
                        className={`badge ${isCustom ? 'badge-info' : 'badge-neutral'}`}
                        style={{ fontSize: '0.625rem', padding: '0.05rem 0.35rem' }}
                      >
                        {isCustom ? 'Custom Override' : 'Inherits Baseline'}
                      </span>
                    </div>

                    {isCustom ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem', color: 'var(--color-text-muted)' }}
                        onClick={() => handleToggleDoorCustom(dId, false)}
                      >
                        ↩️ Reset
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem' }}
                        onClick={() => handleToggleDoorCustom(dId, true)}
                      >
                        ⚙️ Customize Timing
                      </button>
                    )}
                  </div>

                  {isCustom && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.25rem' }}>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${dMode === 'after_start' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.6875rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => handleUpdateDoorTiming(dId, { lock_timing_mode: 'after_start' })}
                        >
                          🛡️ Security Mode (after start)
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${dMode === 'after_end' ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ fontSize: '0.6875rem', padding: '0.2rem 0.5rem' }}
                          onClick={() => handleUpdateDoorTiming(dId, { lock_timing_mode: 'after_end' })}
                        >
                          🕒 Standard Mode (after end)
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Presets:</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)', background: 'rgba(36, 101, 245, 0.08)', color: 'var(--color-accent)' }}
                          onClick={() =>
                            handleUpdateDoorTiming(dId, {
                              lock_timing_mode: 'after_end',
                              lock_offset_min: 0,
                              unlock_offset_min: effectiveDefaultUnlock,
                            })
                          }
                        >
                          🚪 Open entire service
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)' }}
                          onClick={() =>
                            handleUpdateDoorTiming(dId, { lock_timing_mode: 'after_start', lock_offset_min: 0, unlock_offset_min: 15 })
                          }
                        >
                          🔒 Lock at start (0m)
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)' }}
                          onClick={() => handleUpdateDoorTiming(dId, { lock_timing_mode: 'after_start', lock_offset_min: 15 })}
                        >
                          🔒 Lock 15m after start
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', border: '1px solid var(--color-border)' }}
                          onClick={() => handleUpdateDoorTiming(dId, { lock_timing_mode: 'after_end', lock_offset_min: 15 })}
                        >
                          🕒 Lock 15m after end
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', marginBottom: '0.15rem' }}>
                            <span>Unlock before:</span>
                            <strong style={{ color: 'var(--color-accent)' }}>{dUnlock}m</strong>
                          </div>
                          <input
                            type="range"
                            className="form-range"
                            min="0"
                            max="60"
                            step="5"
                            value={dUnlock}
                            onChange={(e) => handleUpdateDoorTiming(dId, { unlock_offset_min: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', marginBottom: '0.15rem' }}>
                            <span>{dMode === 'after_start' ? 'Lock after start:' : 'Lock after end:'}</span>
                            <strong style={{ color: 'var(--color-accent)' }}>{dLock}m</strong>
                          </div>
                          <input
                            type="range"
                            className="form-range"
                            min="0"
                            max={dMode === 'after_start' ? '120' : '60'}
                            step="5"
                            value={dLock}
                            onChange={(e) => handleUpdateDoorTiming(dId, { lock_offset_min: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Projected Preview */}
      <ProjectedUnlockTimesPreview
        sourceType={sourceType}
        selectedResource={selectedResource}
        timeTypes={timeTypes}
        selectedDoorIds={selectedDoorIds}
        doors={doors}
        timingChoice={timingChoice}
        customUnlockMin={customUnlockMin}
        customLockMin={customLockMin}
        doorTimings={doorTimings}
        orgSettings={orgSettings}
      />
    </div>
  );

  // ─── EDIT MODE RENDER ───────────────────────────────────────────────────────
  if (isEditMode && editingMapping) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Edit Rule — ${editingMapping.pco_resource_label}`}
        maxWidth="42rem"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Toggle checked={enabled} onChange={setEnabled} />
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                {enabled ? 'Rule Enabled' : 'Rule Disabled'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || selectedDoorIds.length === 0}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '72vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
          {error && <div className="alert alert-danger">{error}</div>}

          {/* Section Switcher inside Edit Modal */}
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--color-bg-base)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <button
              type="button"
              className={`btn btn-sm ${editTab === 'doors' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1 }}
              onClick={() => setEditTab('doors')}
            >
              🚪 Doors &amp; Triggers ({selectedDoorIds.length})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${editTab === 'timing' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ flex: 1 }}
              onClick={() => setEditTab('timing')}
            >
              🕒 Locking &amp; Per-Door Timing
            </button>
          </div>

          {editTab === 'doors' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {renderDoorPicker()}
              {renderTimeTypesPicker()}
            </div>
          ) : (
            renderTimingEditor()
          )}
        </div>
      </Modal>
    );
  }

  // ─── CREATE MODE RENDER (3-Step Streamlined Wizard) ─────────────────────────
  const totalSteps = 3;
  const stepLabels: Record<number, string> = {
    1: 'Select Planning Center Resource',
    2: 'Select Doors & Triggers',
    3: 'Timing Rules & Confirm',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={preselectedResource ? `Map Doors — ${preselectedResource.resourceLabel}` : 'Add Door Unlock Rule'}
      maxWidth="42rem"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button
            className="btn btn-secondary"
            onClick={step === 1 ? onClose : () => setStep((s) => s - 1)}
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
                (step === 2 && (selectedDoorIds.length === 0 || (sourceType === 'service' && timeTypes.length === 0)))
              }
            >
              Next →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || selectedDoorIds.length === 0}>
              {saving ? 'Saving…' : 'Confirm & Create Rule'}
            </button>
          )}
        </div>
      }
    >
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
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
        Step {step}: {stepLabels[step]}
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Step 1: PCO Resource Selection */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label" style={{ marginBottom: '0.375rem', display: 'block', fontWeight: 600 }}>
              Resource Type
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className={`btn btn-sm ${sourceType === 'service' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setSourceType('service');
                  setSelectedResourceId('');
                }}
              >
                ⛪ Planning Center Service Type
              </button>
              <button
                type="button"
                className={`btn btn-sm ${sourceType === 'group' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setSourceType('group');
                  setSelectedResourceId('');
                }}
              >
                👥 Planning Center Group
              </button>
            </div>
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontWeight: 600 }}>
              Choose {sourceType === 'service' ? 'Service Type' : 'Group'}
            </label>
            {pcoError ? (
              <p style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.875rem' }}>
                Failed to load {sourceType === 'service' ? 'service types' : 'groups'}: {pcoError}
              </p>
            ) : currentResources.length === 0 ? (
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
                {currentResources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{' '}
                    {(r as PcoServiceType).frequency
                      ? `(${(r as PcoServiceType).frequency})`
                      : (r as PcoGroup).schedule
                      ? `(${(r as PcoGroup).schedule})`
                      : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

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
                {((selectedResource as PcoServiceType).frequency || (selectedResource as PcoGroup).schedule) && (
                  <span className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
                    {(selectedResource as PcoServiceType).frequency || (selectedResource as PcoGroup).schedule}
                  </span>
                )}
              </div>

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

      {/* Step 2: Doors + Time Types */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {renderDoorPicker()}
          {renderTimeTypesPicker()}
        </div>
      )}

      {/* Step 3: Timing & Confirm */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '65vh', overflowY: 'auto', paddingRight: '0.25rem' }}>
          {renderTimingEditor()}
        </div>
      )}
    </Modal>
  );
}
