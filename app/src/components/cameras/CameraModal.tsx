'use client';

import React, { useState } from 'react';
import Modal from '@/components/ui/Modal';
import CameraPlayer from './CameraPlayer';
import { createDoorCommand } from '@/lib/firestore';
import type { Camera, Door, UserRole } from '@/lib/types';
import { Lock, Unlock } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  camera: Camera | null;
  role: UserRole | null;
  linkedDoors?: Door[];
}

export default function CameraModal({
  isOpen,
  onClose,
  orgId,
  camera,
  role,
  linkedDoors = [],
}: CameraModalProps) {
  const [busyDoorId, setBusyDoorId] = useState<string | null>(null);
  const canControlDoors = role === 'super_admin' || role === 'org_admin' || role === 'manager';

  if (!camera) return null;

  const handleDoorAction = async (door: Door, action: 'unlock' | 'lock') => {
    setBusyDoorId(door.id);
    try {
      await createDoorCommand(orgId, {
        org_id: orgId,
        status: 'queued',
        door_id: door.id,
        unifi_door_id: door.unifi_door_id,
        door_label: door.label,
        action,
        triggered_by: 'manual',
        execute_at: new Date().toISOString(),
        ...(action === 'unlock' ? { duration_min: 5 } : {}),
      });
    } finally {
      setBusyDoorId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={camera.name} maxWidth="48rem">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <CameraPlayer orgId={orgId} camera={camera} />

        {/* Door action bar — strictly hidden for camera_viewer and viewer */}
        {canControlDoors && linkedDoors.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface-elevated, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border)',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              Linked Doors
            </div>
            {linkedDoors.map((door) => {
              const isUnlocked = door.current_state === 'unlocked';
              const isBusy = busyDoorId === door.id;
              return (
                <div
                  key={door.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{door.label}</span>
                    <span className={`badge ${isUnlocked ? 'badge-success' : 'badge-neutral'}`}>
                      {isUnlocked ? 'Unlocked' : 'Locked'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={isBusy}
                      onClick={() => handleDoorAction(door, 'unlock')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Unlock size={14} />
                      Unlock (5m)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={isBusy}
                      onClick={() => handleDoorAction(door, 'lock')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Lock size={14} />
                      Lock
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
