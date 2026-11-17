'use client';

import React, { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { getVisitorPresets, saveVisitorPresets } from '@/lib/firestore';
import type { Door, VisitorPreset } from '@/lib/types';
import { isDoorHidden } from '@/lib/types';
import { formatDoorDisplayName } from '@/lib/door-status-utils';

interface VisitorPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  doors: Door[];
}

export default function VisitorPresetsModal({
  isOpen,
  onClose,
  orgId,
  doors,
}: VisitorPresetsModalProps) {
  const [presets, setPresets] = useState<VisitorPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationHours, setDurationHours] = useState(4);
  const [doorIds, setDoorIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    setLoading(true);
    getVisitorPresets(orgId)
      .then(setPresets)
      .finally(() => setLoading(false));
  }, [isOpen, orgId]);

  const visibleDoors = React.useMemo(
    () => doors.filter((d) => (d.label || '').trim() && !isDoorHidden(d)),
    [doors]
  );

  const toggleDoor = (id: string) => {
    setDoorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || doorIds.length === 0) return;
    const next: VisitorPreset[] = [
      ...presets,
      {
        id: `preset_${Date.now()}`,
        name: name.trim(),
        description: description.trim() || undefined,
        door_ids: doorIds,
        default_duration_hours: durationHours,
      },
    ];
    setSaving(true);
    try {
      await saveVisitorPresets(orgId, next);
      setPresets(next);
      setName('');
      setDescription('');
      setDurationHours(4);
      setDoorIds([]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const next = presets.filter((p) => p.id !== id);
    setSaving(true);
    try {
      await saveVisitorPresets(orgId, next);
      setPresets(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Visitor Door Presets">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
          Create friendly visit-type presets (e.g., &ldquo;Guest Speaker&rdquo;, &ldquo;HVAC
          Vendor&rdquo;) so form requesters can pick a preset instead of guessing door names.
        </p>

        {loading ? (
          <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>Loading...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {presets.length === 0 ? (
              <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                No presets configured yet.
              </div>
            ) : (
              presets.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.625rem 0.875rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {p.name} ({p.default_duration_hours || 4}h)
                    </div>
                    {p.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                        {p.description}
                      </div>
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                      {p.door_ids.length} door(s)
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={saving}
                    onClick={() => handleDelete(p.id)}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <form
          onSubmit={handleAdd}
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingTop: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Add Preset</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '0.625rem' }}>
            <div>
              <label className="form-label">Preset Name *</label>
              <input
                type="text"
                required
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Guest Speaker"
              />
            </div>
            <div>
              <label className="form-label">Description</label>
              <input
                type="text"
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Sanctuary + Green Room"
              />
            </div>
            <div>
              <label className="form-label">Default Hours</label>
              <input
                type="number"
                min={1}
                max={72}
                className="form-input"
                value={durationHours}
                onChange={(e) => setDurationHours(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="form-label">Included Doors *</label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                gap: '0.4rem',
                maxHeight: '130px',
                overflowY: 'auto',
                padding: '0.5rem',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
              }}
            >
              {visibleDoors.map((d) => (
                <label
                  key={d.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={doorIds.includes(d.id)}
                    onChange={() => toggleDoor(d.id)}
                  />
                  <span>{formatDoorDisplayName(d.label)}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !name.trim() || doorIds.length === 0}>
              {saving ? 'Saving...' : 'Add Preset'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
