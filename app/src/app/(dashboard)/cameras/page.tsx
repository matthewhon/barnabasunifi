'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  subscribeToCameras,
  subscribeToDoors,
  subscribeToUserCameraPermission,
  triggerCameraSync,
  updateCameraSettings,
} from '@/lib/firestore';
import type { Camera, Door, UserCameraPermission } from '@/lib/types';
import { computeOptimalCameraGrid, type CameraGridDimensions } from '@/lib/camera-grid';
import CameraPlayer from '@/components/cameras/CameraPlayer';
import CameraModal from '@/components/cameras/CameraModal';
import { Video, RefreshCw, Maximize2, EyeOff, Eye, Search, ShieldAlert, LayoutGrid, Monitor, X } from 'lucide-react';

type CameraViewMode = '1' | '2' | '3' | 'fit' | 'wall';
const VIEW_MODE_STORAGE_KEY = 'unifi_pco_camera_view_mode';

const VIEW_MODES: ReadonlyArray<{ id: CameraViewMode; label: string; title: string }> = [
  { id: '1', label: '1×1', title: '1 column scrollable grid' },
  { id: '2', label: '2×2', title: '2 column scrollable grid' },
  { id: '3', label: '3×3', title: '3 column scrollable grid' },
  { id: 'fit', label: 'Fit All', title: 'Fit all cameras on screen without scrolling' },
  { id: 'wall', label: 'Wall', title: 'Full-viewport camera wall without scrolling' },
];

export default function CamerasPage() {
  const { user, orgId, role, isSuperAdmin } = useAuth();
  const isAdmin = role === 'org_admin' || isSuperAdmin;
  const isCameraOnly = role === 'camera_viewer';

  const [permission, setPermission] = useState<UserCameraPermission | null | undefined>(undefined);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<CameraViewMode>('2');
  const [lastNonWallViewMode, setLastNonWallViewMode] = useState<Exclude<CameraViewMode, 'wall'>>('2');
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [fitHeight, setFitHeight] = useState<number>(520);
  const [fitGrid, setFitGrid] = useState<CameraGridDimensions>({ cols: 2, rows: 2 });
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === '1' || saved === '2' || saved === '3' || saved === 'fit') {
      setViewMode(saved);
      setLastNonWallViewMode(saved);
    }
  }, []);

  const handleSetViewMode = useCallback((mode: CameraViewMode) => {
    setViewMode(mode);
    if (mode !== 'wall') {
      setLastNonWallViewMode(mode);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      }
    }
  }, []);

  useEffect(() => {
    if (viewMode !== 'wall') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedCamera) {
        setViewMode(lastNonWallViewMode);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, selectedCamera, lastNonWallViewMode]);

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

  const isNoScrollView = viewMode === 'fit' || viewMode === 'wall';

  const updateFitLayout = useCallback(() => {
    const el = gridContainerRef.current;
    if (!el || !isNoScrollView) return;

    const rect = el.getBoundingClientRect();
    let targetHeight = rect.height;

    if (viewMode === 'fit') {
      targetHeight = Math.max(260, Math.floor(window.innerHeight - rect.top - 24));
      setFitHeight(targetHeight);
    }

    const nextGrid = computeOptimalCameraGrid(
      visibleCameras.length,
      rect.width,
      targetHeight,
      viewMode === 'wall'
        ? { gap: 8, padding: 0, footerHeight: 0 }
        : { gap: 10, padding: 16, footerHeight: 34 }
    );
    setFitGrid((prev) =>
      prev.cols === nextGrid.cols && prev.rows === nextGrid.rows ? prev : nextGrid
    );
  }, [isNoScrollView, viewMode, visibleCameras.length]);

  useEffect(() => {
    if (!isNoScrollView) return;
    const rafId = window.requestAnimationFrame(updateFitLayout);
    window.addEventListener('resize', updateFitLayout);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && gridContainerRef.current) {
      observer = new ResizeObserver(() => updateFitLayout());
      observer.observe(gridContainerRef.current);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateFitLayout);
      observer?.disconnect();
    };
  }, [isNoScrollView, updateFitLayout, loading, noAccess, showHidden, search]);

  const standardCols = viewMode === '1' || viewMode === '2' || viewMode === '3' ? Number(viewMode) : 2;

  const renderViewSwitcher = () => (
    <div style={{ display: 'inline-flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {VIEW_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          title={mode.title}
          aria-pressed={viewMode === mode.id}
          onClick={() => handleSetViewMode(mode.id)}
          className="btn btn-sm"
          style={{
            borderRadius: 0,
            background: viewMode === mode.id ? 'rgba(36,101,245,0.18)' : 'transparent',
            color: viewMode === mode.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
            border: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          {mode.id === 'fit' && <LayoutGrid size={13} />}
          {mode.id === 'wall' && <Monitor size={13} />}
          {mode.label}
        </button>
      ))}
    </div>
  );

  const renderCameraActions = (cam: Camera, compactBtn = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
      {isAdmin && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          title={cam.hidden ? 'Unhide camera' : 'Hide camera'}
          onClick={() => toggleHidden(cam)}
          style={compactBtn ? { padding: '0.25rem 0.4rem' } : undefined}
        >
          {cam.hidden ? <Eye size={compactBtn ? 13 : 14} /> : <EyeOff size={compactBtn ? 13 : 14} />}
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        title="Expand camera"
        onClick={() => setSelectedCamera(cam)}
        style={compactBtn ? { padding: '0.25rem 0.4rem' } : undefined}
      >
        <Maximize2 size={compactBtn ? 13 : 14} />
      </button>
    </div>
  );

  if (viewMode === 'wall') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'var(--color-bg-base)',
          display: 'flex',
          flexDirection: 'column',
          padding: '0.75rem',
          gap: '0.625rem',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Video size={18} />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Camera Wall</span>
            {!noAccess && !loading && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {visibleCameras.length} {visibleCameras.length === 1 ? 'camera' : 'cameras'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!noAccess && (
              <div style={{ position: 'relative', width: '13rem' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '0.6rem',
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
                  style={{ paddingLeft: '2rem', height: '2rem', fontSize: '0.8rem' }}
                />
              </div>
            )}

            {renderViewSwitcher()}

            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowHidden((v) => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
              >
                {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                {showHidden ? 'Hide Hidden' : 'Show Hidden'}
              </button>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setViewMode(lastNonWallViewMode)}
              title="Exit Wall View (Esc)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <X size={14} />
              Exit Wall
            </button>
          </div>
        </div>

        {noAccess ? (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center', margin: 'auto' }}>
            <ShieldAlert size={32} color="#f59e0b" style={{ margin: '0 auto 0.75rem' }} />
            <h3 style={{ fontWeight: 600, marginBottom: '0.35rem' }}>No Camera Access</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Ask an organization administrator to grant you access to specific cameras in Users &amp; Roles.
            </p>
          </div>
        ) : loading ? (
          <div
            ref={gridContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
              gap: '0.5rem',
            }}
          >
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton card" style={{ height: '100%' }} />
            ))}
          </div>
        ) : visibleCameras.length === 0 ? (
          <div className="card" style={{ padding: '2.5rem', textAlign: 'center', margin: 'auto' }}>
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
            ref={gridContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: `repeat(${fitGrid.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${fitGrid.rows}, minmax(0, 1fr))`,
              gap: '0.5rem',
            }}
          >
            {visibleCameras.map((cam) => (
              <div
                key={cam.id}
                style={{
                  position: 'relative',
                  minHeight: 0,
                  height: '100%',
                  overflow: 'hidden',
                  borderRadius: 'var(--radius-md)',
                  background: '#060911',
                }}
              >
                <CameraPlayer orgId={orgId!} camera={cam} compact fillContainer />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '1.25rem 0.625rem 0.5rem',
                    background: 'linear-gradient(to top, rgba(6, 9, 17, 0.88) 0%, rgba(6, 9, 17, 0) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      color: '#f8fafc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {cam.name}
                  </span>
                  {renderCameraActions(cam, true)}
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
          {renderViewSwitcher()}

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
        <div style={{ marginBottom: viewMode === 'fit' ? '0.75rem' : '1.25rem', position: 'relative', maxWidth: '22rem' }}>
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
            gridTemplateColumns: `repeat(${standardCols}, minmax(0, 1fr))`,
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
      ) : viewMode === 'fit' ? (
        <div
          ref={gridContainerRef}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${fitGrid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${fitGrid.rows}, minmax(0, 1fr))`,
            gap: '0.625rem',
            height: `${fitHeight}px`,
            overflow: 'hidden',
          }}
        >
          {visibleCameras.map((cam) => (
            <div
              key={cam.id}
              className="card"
              style={{
                padding: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                minHeight: 0,
                height: '100%',
                overflow: 'hidden',
              }}
            >
              <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
                <CameraPlayer orgId={orgId!} camera={cam} compact fillContainer />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexShrink: 0 }}>
                <div style={{ minWidth: 0, fontWeight: 600, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cam.name}
                </div>
                {renderCameraActions(cam, true)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${standardCols}, minmax(0, 1fr))`,
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
                {renderCameraActions(cam)}
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
