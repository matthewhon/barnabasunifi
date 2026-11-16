'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToCameras,
  subscribeToDoors,
  subscribeToUserCameraPermission,
  triggerCameraSync,
  updateCameraSettings,
} from '@/lib/firestore';
import type { Camera, Door, UserCameraPermission } from '@/lib/types';
import CameraPlayer from '@/components/cameras/CameraPlayer';
import CameraModal from '@/components/cameras/CameraModal';
import { Video, RefreshCw, Maximize2, EyeOff, Eye, Search, ShieldAlert } from 'lucide-react';

export default function CamerasPage() {
  const { user, orgId, role, isSuperAdmin } = useAuth();
  const isAdmin = role === 'org_admin' || isSuperAdmin;
  const isCameraOnly = role === 'camera_viewer';

  const [permission, setPermission] = useState<UserCameraPermission | null | undefined>(undefined);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [gridCols, setGridCols] = useState<1 | 2 | 3>(2);
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
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
    const unsub = subscribeToUserCameraPermission(orgId, user.uid, (perm) => {
      setPermission(perm);
    });
    return () => unsub();
  }, [orgId, user, isAdmin]);

  const allowedIdsParam = useMemo(() => {
    if (isAdmin) return null;
    if (permission === undefined) return undefined; // still loading
    if (!permission || permission.access_mode === 'none') return [];
    if (permission.access_mode === 'all') return null;
    return permission.allowed_camera_ids || [];
  }, [isAdmin, permission]);

  useEffect(() => {
    if (!orgId || allowedIdsParam === undefined) return;
    setLoading(true);
    const unsub = subscribeToCameras(
      orgId,
      (list) => {
        setCameras(list);
        setLoading(false);
      },
      allowedIdsParam
    );
    return () => unsub();
  }, [orgId, allowedIdsParam]);

  useEffect(() => {
    if (!orgId || isCameraOnly) {
      setDoors([]);
      return;
    }
    const unsub = subscribeToDoors(orgId, setDoors);
    return () => unsub();
  }, [orgId, isCameraOnly]);

  const visibleCameras = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cameras.filter((c) => {
      if (!isAdmin && c.hidden) return false;
      if (isAdmin && !showHidden && c.hidden) return false;
      if (q && !(c.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cameras, search, isAdmin, showHidden]);

  const handleSync = async () => {
    if (!orgId) return;
    setSyncing(true);
    try {
      await triggerCameraSync(orgId);
    } finally {
      setTimeout(() => setSyncing(false), 1500);
    }
  };

  const toggleHidden = async (cam: Camera) => {
    if (!orgId) return;
    await updateCameraSettings(orgId, cam.id, { hidden: !cam.hidden });
  };

  const linkedDoorsFor = (cam: Camera | null): Door[] => {
    if (!cam || isCameraOnly) return [];
    return doors.filter(
      (d) =>
        d.primary_camera_id === cam.id ||
        (Array.isArray(d.camera_ids) && d.camera_ids.includes(cam.id))
    );
  };

  const noAccess = !isAdmin && permission !== undefined && (!permission || permission.access_mode === 'none');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Video size={24} />
            Cameras
          </h1>
          <p className="page-subtitle">
            {isCameraOnly
              ? 'Live UniFi Protect camera feeds'
              : 'View UniFi Protect cameras and verify door activity'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {([1, 2, 3] as const).map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => setGridCols(cols)}
                className="btn btn-sm"
                style={{
                  borderRadius: 0,
                  background: gridCols === cols ? 'rgba(36,101,245,0.18)' : 'transparent',
                  color: gridCols === cols ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  border: 'none',
                }}
              >
                {cols}×{cols}
              </button>
            ))}
          </div>

          {isAdmin && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowHidden((v) => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                {showHidden ? 'Hide Hidden' : 'Show Hidden'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={syncing}
                onClick={handleSync}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                {syncing ? 'Syncing…' : 'Sync Cameras'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search bar */}
      {!noAccess && (
        <div style={{ marginBottom: '1.25rem', position: 'relative', maxWidth: '22rem' }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-text-muted)',
            }}
          />
          <input
            type="text"
            className="input"
            placeholder="Filter cameras…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
      )}

      {noAccess ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <ShieldAlert size={32} color="#f59e0b" style={{ margin: '0 auto 0.75rem' }} />
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem' }}>No Camera Access</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Ask an organization administrator to grant you access to specific cameras in Users &amp; Roles.
          </p>
        </div>
      ) : loading ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            gap: '1rem',
          }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton card" style={{ height: '16rem' }} />
          ))}
        </div>
      ) : visibleCameras.length === 0 ? (
        <div className="card" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <Video size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
          <h3 style={{ fontWeight: 600, marginBottom: '0.35rem' }}>No Cameras Found</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {isAdmin
              ? 'Enable UniFi Protect in Settings and click Sync Cameras to import cameras from your local agent.'
              : 'No cameras are currently available for your account.'}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            gap: '1rem',
          }}
        >
          {visibleCameras.map((cam) => (
            <div key={cam.id} className="card" style={{ padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <CameraPlayer orgId={orgId!} camera={cam} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.925rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cam.name}
                  </div>
                  {cam.model && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {cam.model}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title={cam.hidden ? 'Unhide camera' : 'Hide camera'}
                      onClick={() => toggleHidden(cam)}
                    >
                      {cam.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    title="Expand camera"
                    onClick={() => setSelectedCamera(cam)}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {orgId && (
        <CameraModal
          isOpen={!!selectedCamera}
          onClose={() => setSelectedCamera(null)}
          orgId={orgId}
          camera={selectedCamera}
          role={role}
          linkedDoors={linkedDoorsFor(selectedCamera)}
        />
      )}
    </div>
  );
}
