'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
import {
  getMappings,
  createMapping,
  updateMapping,
  deleteMapping,
  getDoors,
} from '@/lib/firestore';
import type {
  Mapping,
  Door,
  MappingSourceType,
  PlanTimeType,
  PcoServiceType,
  PcoGroup,
} from '@unfi-pco/shared';
import Modal from '@/components/ui/Modal';

// ─── Icons ────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="toggle-track">
        <div className="toggle-thumb" />
      </div>
    </label>
  );
}

// ─── Mapping Row ──────────────────────────────────────────────────────────────

interface MappingRowProps {
  mapping: Mapping;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string, label: string) => void;
  toggling: boolean;
}

function MappingRow({ mapping, onToggle, onDelete, toggling }: MappingRowProps) {
  return (
    <div
      style={{
        padding: '0.875rem 1.25rem',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '2 1 12rem', minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.9375rem' }}>
          {mapping.pco_resource_label}
        </div>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>
          {mapping.door_labels.length > 0
            ? mapping.door_labels.join(' · ')
            : 'No doors selected'}
        </div>
      </div>

      {mapping.source_type === 'service' && mapping.time_types && (
        <div style={{ flex: '1 1 8rem', display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
          {mapping.time_types.map((tt) => (
            <span key={tt} className="badge badge-neutral" style={{ fontSize: '0.6875rem' }}>
              {tt}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <Toggle
          checked={mapping.enabled}
          onChange={(v) => onToggle(mapping.id, v)}
          disabled={toggling}
        />
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: 'var(--color-danger)', padding: '0.375rem' }}
          onClick={() => onDelete(mapping.id, mapping.pco_resource_label)}
          title="Delete mapping"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ─── Add Mapping Modal ────────────────────────────────────────────────────────

interface AddMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: MappingSourceType;
  pcoResources: Array<PcoServiceType | PcoGroup>;
  doors: Door[];
  onSave: (data: {
    pco_resource_id: string;
    pco_resource_label: string;
    door_ids: string[];
    door_labels: string[];
    time_types: PlanTimeType[];
    enabled: boolean;
  }) => Promise<void>;
  saving: boolean;
}

function AddMappingModal({
  isOpen,
  onClose,
  sourceType,
  pcoResources,
  doors,
  onSave,
  saving,
}: AddMappingModalProps) {
  const [step, setStep] = useState(1);
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [selectedDoorIds, setSelectedDoorIds] = useState<string[]>([]);
  const [timeTypes, setTimeTypes] = useState<PlanTimeType[]>(['service']);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setSelectedResourceId('');
    setSelectedDoorIds([]);
    setTimeTypes(['service']);
    setEnabled(true);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleDoor(id: string) {
    setSelectedDoorIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  function toggleTimeType(tt: PlanTimeType) {
    setTimeTypes((prev) =>
      prev.includes(tt) ? prev.filter((t) => t !== tt) : [...prev, tt],
    );
  }

  async function handleSave() {
    setError(null);
    if (!selectedResourceId) { setError('Please select a PCO resource.'); return; }
    if (selectedDoorIds.length === 0) { setError('Please select at least one door.'); return; }
    if (sourceType === 'service' && timeTypes.length === 0) { setError('Please select at least one time type.'); return; }

    const resource = pcoResources.find((r) => r.id === selectedResourceId);
    const selectedDoors = doors.filter((d) => selectedDoorIds.includes(d.id));

    await onSave({
      pco_resource_id: selectedResourceId,
      pco_resource_label: resource?.name ?? selectedResourceId,
      door_ids: selectedDoorIds,
      door_labels: selectedDoors.map((d) => d.label),
      time_types: sourceType === 'service' ? timeTypes : [],
      enabled,
    });
    reset();
  }

  const totalSteps = sourceType === 'service' ? 4 : 3;

  const stepLabel = (s: number) => {
    const labels: Record<number, string> = {
      1: 'Select PCO Resource',
      2: 'Select Doors',
      3: sourceType === 'service' ? 'Time Types' : 'Enable',
      4: 'Enable',
    };
    return labels[s] ?? `Step ${s}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Add ${sourceType === 'service' ? 'Service' : 'Group'} Mapping`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <button
            className="btn btn-secondary"
            onClick={step === 1 ? handleClose : () => setStep((s) => s - 1)}
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
                (step === 2 && selectedDoorIds.length === 0)
              }
            >
              Next →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Mapping'}
            </button>
          )}
        </div>
      }
    >
      {/* Step indicator */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', alignItems: 'center' }}>
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
                transition: 'all 0.2s ease',
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
                  transition: 'background 0.2s ease',
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
        Step {step}: {stepLabel(step)}
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Step 1: PCO resource */}
      {step === 1 && (
        <div className="form-group">
          <label className="form-label">
            {sourceType === 'service' ? 'Service Type' : 'Group'}
          </label>
          {pcoResources.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              No {sourceType === 'service' ? 'service types' : 'groups'} found. Ensure PCO is connected.
            </p>
          ) : (
            <select
              className="form-select"
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
            >
              <option value="">Select a {sourceType === 'service' ? 'service type' : 'group'}…</option>
              {pcoResources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Step 2: Door selection */}
      {step === 2 && (
        <div>
          <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
            Select Doors ({selectedDoorIds.length} selected)
          </label>
          {doors.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              No doors available. Configure the local agent first.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '16rem', overflowY: 'auto' }}>
              {doors.map((door) => (
                <label
                  key={door.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.625rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: selectedDoorIds.includes(door.id)
                      ? 'rgba(36,101,245,0.1)'
                      : 'var(--color-bg-elevated)',
                    border: `1px solid ${selectedDoorIds.includes(door.id) ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                    transition: 'all 0.15s ease',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedDoorIds.includes(door.id)}
                    onChange={() => toggleDoor(door.id)}
                  />
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{door.label}</span>
                  <span
                    className={`badge ${
                      door.current_state === 'locked' ? 'badge-danger' :
                      door.current_state === 'unlocked' ? 'badge-success' :
                      'badge-neutral'
                    }`}
                    style={{ marginLeft: 'auto', fontSize: '0.6875rem' }}
                  >
                    {door.current_state}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Time types (services only) */}
      {step === 3 && sourceType === 'service' && (
        <div>
          <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
            Which time types should trigger an unlock?
          </label>
          {(['service', 'rehearsal', 'other'] as PlanTimeType[]).map((tt) => (
            <label
              key={tt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.625rem',
                marginBottom: '0.5rem',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                background: timeTypes.includes(tt)
                  ? 'rgba(36,101,245,0.1)'
                  : 'var(--color-bg-elevated)',
                border: `1px solid ${timeTypes.includes(tt) ? 'rgba(36,101,245,0.3)' : 'var(--color-border)'}`,
                transition: 'all 0.15s ease',
                fontSize: '0.9375rem',
                fontWeight: 500,
              }}
            >
              <input
                type="checkbox"
                checked={timeTypes.includes(tt)}
                onChange={() => toggleTimeType(tt)}
              />
              <span style={{ color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>{tt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Final step: Enable toggle */}
      {((step === 4 && sourceType === 'service') || (step === 3 && sourceType === 'group')) && (
        <div>
          <label className="form-label" style={{ marginBottom: '1rem', display: 'block' }}>
            Mapping Status
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Toggle checked={enabled} onChange={setEnabled} />
            <span style={{ fontSize: '0.9375rem', color: 'var(--color-text-primary)' }}>
              {enabled ? 'Enabled — this mapping will trigger door unlocks' : 'Disabled — no door actions will be taken'}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MappingsPage() {
  const { orgId } = useAuth();

  const [tab, setTab] = useState<MappingSourceType>('service');
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [pcoResources, setPcoResources] = useState<Array<PcoServiceType | PcoGroup>>([]);
  const [pcoLoading, setPcoLoading] = useState(false);
  const [mappingsLoading, setMappingsLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingLabel, setDeletingLabel] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  function showFeedback(text: string, ok: boolean) {
    setFeedback({ text, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  // Load mappings and doors
  useEffect(() => {
    if (!orgId) return;
    Promise.all([getMappings(orgId), getDoors(orgId)]).then(([m, d]) => {
      setMappings(m);
      setDoors(d);
      setMappingsLoading(false);
    });
  }, [orgId]);

  // Load PCO resources when tab changes
  useEffect(() => {
    if (!orgId) return;
    setPcoLoading(true);
    const getPcoResources = httpsCallable<
      { orgId: string; type: MappingSourceType },
      { resources: Array<PcoServiceType | PcoGroup> }
    >(functions, 'getPcoResources');

    getPcoResources({ orgId, type: tab })
      .then((res) => setPcoResources(res.data.resources ?? []))
      .catch(() => setPcoResources([]))
      .finally(() => setPcoLoading(false));
  }, [orgId, tab]);

  const filteredMappings = mappings.filter((m) => m.source_type === tab);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!orgId) return;
      setToggling(id);
      try {
        await updateMapping(orgId, id, { enabled });
        setMappings((prev) =>
          prev.map((m) => (m.id === id ? { ...m, enabled } : m)),
        );
      } catch {
        showFeedback('Failed to update mapping.', false);
      } finally {
        setToggling(null);
      }
    },
    [orgId],
  );

  function openDeleteModal(id: string, label: string) {
    setDeletingId(id);
    setDeletingLabel(label);
    setDeleteModalOpen(true);
  }

  const handleDeleteConfirm = useCallback(async () => {
    if (!orgId || !deletingId) return;
    setDeleting(true);
    try {
      await deleteMapping(orgId, deletingId);
      setMappings((prev) => prev.filter((m) => m.id !== deletingId));
      setDeleteModalOpen(false);
      showFeedback('Mapping deleted.', true);
    } catch {
      showFeedback('Failed to delete mapping.', false);
    } finally {
      setDeleting(false);
    }
  }, [orgId, deletingId]);

  const handleSaveMapping = useCallback(
    async (data: {
      pco_resource_id: string;
      pco_resource_label: string;
      door_ids: string[];
      door_labels: string[];
      time_types: PlanTimeType[];
      enabled: boolean;
    }) => {
      if (!orgId) return;
      setSaving(true);
      try {
        const id = await createMapping(orgId, {
          source_type: tab,
          ...data,
        });
        const newMapping: Mapping = {
          id,
          org_id: orgId,
          source_type: tab,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...data,
        };
        setMappings((prev) => [...prev, newMapping]);
        setModalOpen(false);
        showFeedback('Mapping created successfully.', true);
      } catch {
        showFeedback('Failed to save mapping.', false);
      } finally {
        setSaving(false);
      }
    },
    [orgId, tab],
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Mappings</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
          <PlusIcon />
          Add Mapping
        </button>
      </div>

      {feedback && (
        <div className={`alert ${feedback.ok ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1.5rem' }}>
          {feedback.text}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {(['service', 'group'] as MappingSourceType[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'service' ? 'Services' : 'Groups'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left panel: PCO resources */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.875rem', fontSize: '0.875rem' }}>
            {tab === 'service' ? 'PCO Service Types' : 'PCO Groups'}
          </div>
          {pcoLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" style={{ height: '2.25rem', borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          ) : pcoResources.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <p className="empty-state-title" style={{ fontSize: '0.875rem' }}>
                No {tab === 'service' ? 'service types' : 'groups'} found
              </p>
              <p style={{ fontSize: '0.8125rem' }}>
                Ensure Planning Center is connected in Settings.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {pcoResources.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border)',
                    fontSize: '0.875rem',
                    color: 'var(--color-text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  {mappings.some((m) => m.pco_resource_id === r.id) && (
                    <span className="badge badge-success" style={{ fontSize: '0.6875rem' }}>
                      Mapped
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: existing mappings */}
        <div>
          <div
            style={{
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: '0.875rem',
              fontSize: '0.875rem',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Active Mappings ({filteredMappings.length})</span>
          </div>

          {mappingsLoading ? (
            <div className="card" style={{ padding: '1rem' }}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: '3.5rem', marginBottom: '0.5rem', borderRadius: 'var(--radius-md)' }} />
              ))}
            </div>
          ) : filteredMappings.length === 0 ? (
            <div className="card empty-state">
              <p className="empty-state-title">
                No {tab === 'service' ? 'service' : 'group'} mappings yet
              </p>
              <p style={{ fontSize: '0.875rem' }}>
                Click &quot;Add Mapping&quot; to link a PCO resource to UniFi doors.
              </p>
            </div>
          ) : (
            <div className="card" style={{ padding: '0' }}>
              {filteredMappings.map((m) => (
                <MappingRow
                  key={m.id}
                  mapping={m}
                  onToggle={handleToggle}
                  onDelete={openDeleteModal}
                  toggling={toggling === m.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Mapping Modal */}
      <AddMappingModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        sourceType={tab}
        pcoResources={pcoResources}
        doors={doors}
        onSave={handleSaveMapping}
        saving={saving}
      />

      {/* Delete Confirmation */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => !deleting && setDeleteModalOpen(false)}
        title="Delete Mapping"
        footer={
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Are you sure you want to delete the mapping for{' '}
          <strong style={{ color: 'var(--color-text-primary)' }}>{deletingLabel}</strong>?
        </p>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
          This will not affect existing schedule windows, but no new windows will be created for this resource.
        </p>
      </Modal>

      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns: 1fr 1.5fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
