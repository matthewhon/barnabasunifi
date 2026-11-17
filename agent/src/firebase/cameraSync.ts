/**
 * firebase/cameraSync.ts
 * Syncs UniFi Protect cameras across one or more Protect consoles/NVRs to Firestore
 * and uploads JPEG snapshots to Firebase Storage (with fast-refresh support for active viewers).
 */

import { getDb, uploadCameraSnapshot } from '../firebase';
import { ProtectManager, UnifiProtectCamera } from '../unifi/protect';
import { logger } from '../logger';
import { syncGo2RtcStreams } from '../unifi/go2rtc';

const seededCameras = new Set<string>();

function mapCameraState(raw: string): 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' {
  const upper = (raw || '').toUpperCase();
  if (upper === 'CONNECTED') return 'CONNECTED';
  if (upper === 'CONNECTING') return 'CONNECTING';
  return 'DISCONNECTED';
}

export async function captureCameraSnapshot(
  orgId: string,
  cameraId: string,
  protectManager: ProtectManager
): Promise<boolean> {
  if (!protectManager.isConfigured()) return false;
  try {
    const db = getDb();
    const camSnap = await db.doc(`organizations/${orgId}/cameras/${cameraId}`).get();
    const consoleId = camSnap.exists ? (camSnap.data()?.console_id as string | undefined) : undefined;
    const unifiCamId = (camSnap.exists ? (camSnap.data()?.unifi_camera_id as string | undefined) : undefined) || cameraId;

    const primaryClient = protectManager.getClientForConsole(consoleId);
    const candidates = primaryClient
      ? [primaryClient, ...protectManager.getConsoles().map((c) => c.client).filter((c) => c !== primaryClient)]
      : protectManager.getConsoles().map((c) => c.client);

    let jpeg: Buffer | null = null;
    let lastErr: any = null;
    for (const client of candidates) {
      try {
        jpeg = await client.getSnapshot(unifiCamId);
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!jpeg) {
      throw lastErr || new Error('No Protect console could capture snapshot');
    }

    const storagePath = `organizations/${orgId}/cameras/${cameraId}/latest.jpg`;
    await uploadCameraSnapshot(storagePath, jpeg);
    await db.doc(`organizations/${orgId}/cameras/${cameraId}`).set(
      {
        snapshot_storage_path: storagePath,
        snapshot_updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
    return true;
  } catch (err: any) {
    logger.warn(`[CameraSync] Snapshot failed for ${cameraId}: ${err.message}`);
    return false;
  }
}

export async function syncCameras(
  orgId: string,
  protectManager: ProtectManager,
  enableGo2Rtc = false
): Promise<UnifiProtectCamera[]> {
  if (!protectManager.isConfigured()) return [];

  const db = getDb();
  const nowIso = new Date().toISOString();
  const allCameras: UnifiProtectCamera[] = [];
  const errors: string[] = [];

  for (const entry of protectManager.getConsoles()) {
    try {
      const cameras = await entry.client.getCameras();
      for (const cam of cameras) {
        const storagePath = `organizations/${orgId}/cameras/${cam.id}/latest.jpg`;
        await db.doc(`organizations/${orgId}/cameras/${cam.id}`).set(
          {
            id: cam.id,
            org_id: orgId,
            unifi_camera_id: cam.id,
            console_id: entry.id,
            console_label: entry.label,
            name: cam.name || cam.id,
            model: cam.modelKey || cam.type || null,
            state: mapCameraState(cam.state),
            is_recording: Boolean(cam.isRecording),
            has_mic: Boolean(cam.featureFlags?.hasMic),
            has_speaker: Boolean(cam.featureFlags?.hasSpeaker),
            snapshot_storage_path: storagePath,
            last_synced: nowIso,
          },
          { merge: true }
        );
        allCameras.push(cam);
        if (!seededCameras.has(cam.id)) {
          seededCameras.add(cam.id);
          captureCameraSnapshot(orgId, cam.id, protectManager).catch(() => {});
        }
      }

      if (enableGo2Rtc && cameras.length > 0) {
        syncGo2RtcStreams(cameras, entry.client).catch((err) => {
          logger.debug(`[go2rtc] Stream registration skipped (${entry.label}): ${err.message}`);
        });
      }
    } catch (err: any) {
      const msg = `${entry.label}: ${err.message}`;
      logger.warn(`[CameraSync] Failed syncing console ${msg}`);
      errors.push(msg);
    }
  }

  if (allCameras.length === 0 && errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  return allCameras;
}

/**
 * Starts background camera metadata sync (every 60s) and active-viewer
 * snapshot polling (every 2.5s only for cameras with an active live_view_until lease).
 */
export function startCameraSyncIntervals(
  orgId: string,
  protectManager: ProtectManager,
  enableGo2Rtc = false
): () => void {
  let stopped = false;

  const metaTimer = setInterval(async () => {
    if (stopped || !protectManager.isConfigured()) return;
    try {
      await syncCameras(orgId, protectManager, enableGo2Rtc);
    } catch (err: any) {
      logger.warn(`[CameraSync] Periodic camera sync error: ${err.message}`);
    }
  }, 60_000);

  const liveSnapshotTimer = setInterval(async () => {
    if (stopped || !protectManager.isConfigured()) return;
    try {
      const nowIso = new Date().toISOString();
      const snap = await getDb()
        .collection(`organizations/${orgId}/cameras`)
        .where('live_view_until', '>', nowIso)
        .get();

      for (const doc of snap.docs) {
        if (stopped) break;
        await captureCameraSnapshot(orgId, doc.id, protectManager);
      }
    } catch (err: any) {
      logger.debug(`[CameraSync] Live snapshot poll error: ${err.message}`);
    }
  }, 2500);

  return () => {
    stopped = true;
    clearInterval(metaTimer);
    clearInterval(liveSnapshotTimer);
  };
}

const lastEventCaptureMs = new Map<string, number>();

/**
 * Capture and upload an event-triggered JPEG snapshot (last_event.jpg) for a camera.
 * Debounced per camera (10s) to avoid flooding Storage during continuous motion.
 */
export async function captureCameraEventSnapshot(
  orgId: string,
  cameraId: string,
  eventType: string,
  eventLabel: string,
  protectManager: ProtectManager
): Promise<boolean> {
  if (!protectManager.isConfigured()) return false;
  const now = Date.now();
  const prev = lastEventCaptureMs.get(cameraId) || 0;
  if (now - prev < 10_000) return false;
  lastEventCaptureMs.set(cameraId, now);

  try {
    const db = getDb();
    const camSnap = await db.doc(`organizations/${orgId}/cameras/${cameraId}`).get();
    const consoleId = camSnap.exists ? (camSnap.data()?.console_id as string | undefined) : undefined;
    const unifiCamId = (camSnap.exists ? (camSnap.data()?.unifi_camera_id as string | undefined) : undefined) || cameraId;

    const primaryClient = protectManager.getClientForConsole(consoleId);
    const candidates = primaryClient
      ? [primaryClient, ...protectManager.getConsoles().map((c) => c.client).filter((c) => c !== primaryClient)]
      : protectManager.getConsoles().map((c) => c.client);

    let jpeg: Buffer | null = null;
    for (const client of candidates) {
      try {
        jpeg = await client.getSnapshot(unifiCamId);
        break;
      } catch {
        // try next console
      }
    }
    if (!jpeg) return false;

    const storagePath = `organizations/${orgId}/cameras/${cameraId}/last_event.jpg`;
    await uploadCameraSnapshot(storagePath, jpeg);
    await db.doc(`organizations/${orgId}/cameras/${cameraId}`).set(
      {
        last_event_storage_path: storagePath,
        last_event_at: new Date(now).toISOString(),
        last_event_type: eventType,
        last_event_label: eventLabel,
      },
      { merge: true }
    );
    return true;
  } catch (err: any) {
    logger.debug(`[CameraSync] Event snapshot failed for ${cameraId}: ${err.message}`);
    return false;
  }
}

function formatSmartDetectLabel(eventType: string, smartTypes?: string[]): string {
  if (eventType === 'ring') return 'Doorbell Ring';
  if (Array.isArray(smartTypes) && smartTypes.length > 0) {
    const primary = smartTypes[0];
    if (primary === 'person') return 'Person Detected';
    if (primary === 'vehicle') return 'Vehicle Detected';
    if (primary === 'animal') return 'Animal Detected';
    if (primary === 'licensePlate') return 'License Plate Detected';
    return `${primary} Detected`;
  }
  return 'Motion Detected';
}

/**
 * Subscribes to real-time Protect Integration WebSocket events across all configured consoles
 * and captures a snapshot whenever motion, smart detection, or ring occurs.
 */
export function startProtectEventSubscriptions(
  orgId: string,
  protectManager: ProtectManager
): () => void {
  const unsubs: Array<() => void> = [];
  for (const entry of protectManager.getConsoles()) {
    const unsub = entry.client.subscribeToEvents((evt) => {
      const item = evt?.item;
      if (!item || item.modelKey !== 'event') return;
      const evType = String(item.type || '');
      if (evType !== 'motion' && evType !== 'smartDetectZone' && evType !== 'ring') return;
      const camId = item.device;
      if (!camId || typeof camId !== 'string') return;
      const label = formatSmartDetectLabel(evType, item.smartDetectTypes);
      captureCameraEventSnapshot(orgId, camId, evType, label, protectManager).catch(() => {});
    });
    unsubs.push(unsub);
  }
  return () => {
    unsubs.forEach((u) => u());
  };
}
