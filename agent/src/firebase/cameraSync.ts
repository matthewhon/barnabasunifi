/**
 * firebase/cameraSync.ts
 * Syncs UniFi Protect cameras to Firestore and uploads JPEG snapshots
 * to Firebase Storage (with fast-refresh support for active viewers).
 */

import { getDb, uploadCameraSnapshot } from '../firebase';
import { UnifiProtectClient, UnifiProtectCamera } from '../unifi/protect';
import { logger } from '../logger';
import { syncGo2RtcStreams } from '../unifi/go2rtc';

function mapCameraState(raw: string): 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' {
  const upper = (raw || '').toUpperCase();
  if (upper === 'CONNECTED') return 'CONNECTED';
  if (upper === 'CONNECTING') return 'CONNECTING';
  return 'DISCONNECTED';
}

export async function captureCameraSnapshot(
  orgId: string,
  cameraId: string,
  protectClient: UnifiProtectClient
): Promise<boolean> {
  if (!protectClient.isConfigured()) return false;
  try {
    const jpeg = await protectClient.getSnapshot(cameraId);
    const storagePath = `organizations/${orgId}/cameras/${cameraId}/latest.jpg`;
    await uploadCameraSnapshot(storagePath, jpeg);
    await getDb().doc(`organizations/${orgId}/cameras/${cameraId}`).set(
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
  protectClient: UnifiProtectClient,
  enableGo2Rtc = false
): Promise<UnifiProtectCamera[]> {
  if (!protectClient.isConfigured()) return [];

  const cameras = await protectClient.getCameras();
  const db = getDb();
  const nowIso = new Date().toISOString();

  for (const cam of cameras) {
    const storagePath = `organizations/${orgId}/cameras/${cam.id}/latest.jpg`;
    await db.doc(`organizations/${orgId}/cameras/${cam.id}`).set(
      {
        id: cam.id,
        org_id: orgId,
        unifi_camera_id: cam.id,
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
  }

  if (enableGo2Rtc && cameras.length > 0) {
    syncGo2RtcStreams(cameras, protectClient).catch((err) => {
      logger.debug(`[go2rtc] Stream registration skipped: ${err.message}`);
    });
  }

  return cameras;
}

/**
 * Starts background camera metadata sync (every 60s) and active-viewer
 * snapshot polling (every 2.5s only for cameras with an active live_view_until lease).
 */
export function startCameraSyncIntervals(
  orgId: string,
  protectClient: UnifiProtectClient,
  enableGo2Rtc = false
): () => void {
  let stopped = false;

  const metaTimer = setInterval(async () => {
    if (stopped || !protectClient.isConfigured()) return;
    try {
      await syncCameras(orgId, protectClient, enableGo2Rtc);
    } catch (err: any) {
      logger.warn(`[CameraSync] Periodic camera sync error: ${err.message}`);
    }
  }, 60_000);

  const liveSnapshotTimer = setInterval(async () => {
    if (stopped || !protectClient.isConfigured()) return;
    try {
      const nowIso = new Date().toISOString();
      const snap = await getDb()
        .collection(`organizations/${orgId}/cameras`)
        .where('live_view_until', '>', nowIso)
        .get();

      for (const doc of snap.docs) {
        if (stopped) break;
        const camId = doc.data()?.unifi_camera_id || doc.id;
        await captureCameraSnapshot(orgId, String(camId), protectClient);
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
