'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToCameras,
  subscribeToDoors,
  subscribeToUserCameraPermission,
} from '@/lib/firestore';
import type { Camera, Door, UserCameraPermission } from '@/lib/types';
import CameraPlayer from '@/components/cameras/CameraPlayer';
import CameraModal from '@/components/cameras/CameraModal';
import { Video, Maximize2, ShieldAlert } from 'lucide-react';

export default function MobileCamerasPage() {
  const { user, orgId, role, isSuperAdmin } = useAuth();
  const isAdmin = role === 'org_admin' || isSuperAdmin;
  const isCameraOnly = role === 'camera_viewer';

  const [permission, setPermission] = useState<UserCameraPermission | null | undefined>(undefined);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  useEffect(() => {
    if (!orgId || !user) return;
    if (isAdmin) {
      setPermission({
        uid: user.uid,
        org_id: orgId,
        access_mode: 'all',
        allowed_camera_ids: [],
        onsite_only: false,
        allow_notifications: true,
        updated_at: '',
      });
      return;
    }
    return subscribeToUserCameraPermission(orgId, user.uid, setPermission);
  }, [orgId, user, isAdmin]);

  const allowedIdsParam = useMemo(() => {
    if (isAdmin) return null;
    if (permission === undefined) return undefined;
    if (!permission || permission.access_mode === 'none') return [];
    if (permission.access_mode === 'all') return null;
    return permission.allowed_camera_ids || [];
  }, [isAdmin, permission]);

  useEffect(() => {
    if (!orgId || allowedIdsParam === undefined) return;
    setLoading(true);
    return subscribeToCameras(
      orgId,
      (list) => {
        setCameras(list.filter((c) => !c.hidden));
        setLoading(false);
      },
      allowedIdsParam
    );
  }, [orgId, allowedIdsParam]);

  useEffect(() => {
    if (!orgId || isCameraOnly) {
      setDoors([]);
      return;
    }
    return subscribeToDoors(orgId, setDoors);
  }, [orgId, isCameraOnly]);

  const noAccess = !isAdmin && permission !== undefined && (!permission || permission.access_mode === 'none');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', padding: '0.75rem 1rem 5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Video size={18} />
        <h1 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Cameras</h1>
      </div>

      {noAccess ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <ShieldAlert size={28} color="#f59e0b" style={{ margin: '0 auto 0.5rem' }} />
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>No Camera Access</div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Ask your admin to grant camera permissions to your account.
          </p>
        </div>
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[1, 2].map((i) => (
            <div key={i} className="skeleton card" style={{ height: '13rem' }} />
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          No cameras available.
        </div>
      ) : (
        cameras.map((cam) => (
          <div key={cam.id} className="card" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <CameraPlayer orgId={orgId!} camera={cam} compact />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{cam.name}</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedCamera(cam)}
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
        ))
      )}

      {orgId && (
        <CameraModal
          isOpen={!!selectedCamera}
          onClose={() => setSelectedCamera(null)}
          orgId={orgId}
          camera={selectedCamera}
          role={role}
          linkedDoors={
            selectedCamera && !isCameraOnly
              ? doors.filter(
                  (d) =>
                    d.primary_camera_id === selectedCamera.id ||
                    (Array.isArray(d.camera_ids) && d.camera_ids.includes(selectedCamera.id))
                )
              : []
          }
        />
      )}
    </div>
  );
}
