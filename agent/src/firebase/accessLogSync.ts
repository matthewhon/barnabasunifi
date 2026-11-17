/**
 * firebase/accessLogSync.ts
 * Syncs UniFi Access door opening/closing activity & access methods into Firestore.
 *
 * Fetches access logs (user credentials, access method, timestamps, door open/close)
 * from UniFi Access and streams them into:
 * /organizations/{orgId}/access_logs/{logId}
 */

import { getDb, firestoreTimestamp } from '../firebase';
import { UnifiAccessClient, AccessLogEntry } from '../unifi/access';
import { ProtectManager } from '../unifi/protect';
import { captureCameraEventSnapshot } from './cameraSync';
import { logger } from '../logger';
import {
  captureUnlockEventSnapshot,
  DoorSnapshotDoc,
  evaluateUnlockSnapshotRule,
  ScheduleWindowSnapshotDoc,
} from './unlockSnapshotRule';

let _lastSyncedEpochSeconds = 0;
let _isSyncRunning = false;
const _processedSnapshotLogIds = new Set<string>();
const _capturedCameraEventLogIds = new Set<string>();
const RECENT_EVENT_MAX_AGE_MS = 120_000;

function trackBoundedLogId(set: Set<string>, logId: string): void {
  set.add(logId);
  if (set.size > 2000) {
    const first = set.values().next().value;
    if (first) set.delete(first);
  }
}

export interface AccessLogSyncOptions {
  lookbackDays?: number;
  maxPages?: number;
  forceFull?: boolean;
  protectManager?: ProtectManager;
}

/**
 * Fetch new access logs from UniFi Access and upsert into Firestore.
 * Supports deep historical lookback and multi-page pagination.
 */
export async function syncAccessLogs(
  orgId: string,
  unifiClient: UnifiAccessClient,
  options?: AccessLogSyncOptions
): Promise<AccessLogEntry[]> {
  if (_isSyncRunning && !options?.forceFull) {
    return [];
  }
  _isSyncRunning = true;
  try {
    return await _syncAccessLogsInner(orgId, unifiClient, options);
  } finally {
    _isSyncRunning = false;
  }
}

async function _syncAccessLogsInner(
  orgId: string,
  unifiClient: UnifiAccessClient,
  options?: AccessLogSyncOptions
): Promise<AccessLogEntry[]> {
  const db = getDb();
  let entries: AccessLogEntry[] = [];

  // 1. Look up last synced timestamp if not cached in memory
  if (_lastSyncedEpochSeconds === 0 && !options?.forceFull) {
    try {
      const stateSnap = await db
        .doc(`organizations/${orgId}/settings/access_log_sync`)
        .get();
      if (stateSnap.exists) {
        _lastSyncedEpochSeconds = stateSnap.data()?.last_synced_epoch || 0;
      }
    } catch {}
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const isFullOrInitial = options?.forceFull || _lastSyncedEpochSeconds === 0;
  const defaultDays = options?.lookbackDays || 90;
  const since = isFullOrInitial
    ? nowEpoch - defaultDays * 24 * 60 * 60
    : Math.max(0, _lastSyncedEpochSeconds - 180);
  const maxPages = isFullOrInitial ? (options?.maxPages || 50) : (options?.maxPages || 5);

  logger.info(
    `[AccessLogSync] Fetching access logs from UniFi (since: ${new Date(since * 1000).toISOString()}, maxPages: ${maxPages}, mode: ${isFullOrInitial ? 'deep_history' : 'incremental'})…`
  );

  try {
    entries = await unifiClient.getAccessLogs({
      since,
      pageSize: 100,
      topic: 'door_openings',
      maxPages,
    });
  } catch (err) {
    logger.error(`[AccessLogSync] Failed to fetch access logs from UniFi: ${String(err)}`);
    return [];
  }

  if (entries.length === 0) {
    logger.debug('[AccessLogSync] No new access logs from UniFi.');
    return [];
  }

  logger.info(`[AccessLogSync] Processing ${entries.length} log entry(s) for Firestore permanent archive…`);

  // 1b. Evaluate unlock snapshot rules for recent events if Protect is configured
  const protectManager = options?.protectManager;
  const nowMs = Date.now();
  const recentCandidates =
    protectManager && protectManager.isConfigured()
      ? entries.filter((e) => {
          if (!e.id || !e.door_id) return false;
          if (_processedSnapshotLogIds.has(e.id)) return false;
          const isUnlockOrDenied =
            (e.event_type === 'door_unlock' && e.event_result === 'success') ||
            e.event_type === 'access_denied' ||
            e.event_result === 'denied';
          if (!isUnlockOrDenied) return false;
          const tsMs = Date.parse(e.timestamp);
          return !isNaN(tsMs) && nowMs - tsMs <= RECENT_EVENT_MAX_AGE_MS;
        })
      : [];

  if (recentCandidates.length > 0 && protectManager) {
    try {
      const [settingsSnap, doorsSnap, windowsSnap] = await Promise.all([
        db.doc(`organizations/${orgId}/settings/config`).get(),
        db.collection(`organizations/${orgId}/doors`).get(),
        db
          .collection(`organizations/${orgId}/schedule_windows`)
          .where('status', 'in', ['pending', 'unlocked', 'locked'])
          .get(),
      ]);

      const timeZone = String(settingsSnap.data()?.timezone || 'America/Chicago');
      const doorMap = new Map<string, DoorSnapshotDoc>();
      for (const d of doorsSnap.docs) {
        doorMap.set(d.id, { id: d.id, ...(d.data() as Omit<DoorSnapshotDoc, 'id'>) });
      }
      const windows: ScheduleWindowSnapshotDoc[] = windowsSnap.docs.map((w) => ({
        id: w.id,
        ...(w.data() as Omit<ScheduleWindowSnapshotDoc, 'id'>),
      }));

      for (const entry of recentCandidates) {
        trackBoundedLogId(_processedSnapshotLogIds, entry.id);
        const doorDoc = doorMap.get(entry.door_id) || null;
        const evalResult = evaluateUnlockSnapshotRule(entry, doorDoc, windows, timeZone);

        if (evalResult.shouldCapture && evalResult.cameraId) {
          const storagePath = await captureUnlockEventSnapshot(
            orgId,
            evalResult.cameraId,
            entry.id,
            protectManager
          );
          if (storagePath) {
            entry.snapshot_storage_path = storagePath;
            entry.snapshot_camera_id = evalResult.cameraId;
            entry.snapshot_captured_at = new Date().toISOString();
            logger.info(
              `[UnlockSnapshot] Captured unlock photo for door "${entry.door_label}" (log ${entry.id})`
            );
          }
        } else if (
          doorDoc?.unlock_snapshot_config?.enabled &&
          evalResult.reason &&
          evalResult.reason !== 'capture_disabled' &&
          evalResult.reason !== 'event_type_ignored'
        ) {
          entry.snapshot_skipped_reason = evalResult.reason;
        }
      }
    } catch (err: any) {
      logger.warn(`[UnlockSnapshot] Rule evaluation/capture error: ${err.message}`);
    }
  }

  // 2. Commit logs to Firestore in safe chunks (max 400 operations per batch)
  const now = firestoreTimestamp.now();
  let latestEventEpoch = _lastSyncedEpochSeconds;

  // Track latest access per door to update door document
  const doorLatestAccess = new Map<
    string,
    { timestamp: string; userName: string; accessMethod: string; accessMethodLabel: string }
  >();

  const CHUNK_SIZE = 400;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);
    const chunkBatch = db.batch();

    for (const entry of chunk) {
      if (!entry.id) continue;
      const docRef = db.doc(`organizations/${orgId}/access_logs/${entry.id}`);
      const record = {
        ...entry,
        org_id: orgId,
        synced_at: now,
      };
      chunkBatch.set(docRef, record, { merge: true });

      // Track latest timestamp seen
      const eventEpoch = Math.floor(new Date(entry.timestamp).getTime() / 1000);
      if (!isNaN(eventEpoch) && eventEpoch > latestEventEpoch) {
        latestEventEpoch = eventEpoch;
      }

      // Door last accessed metadata
      if (entry.door_id && entry.user_name && entry.event_result === 'success') {
        const existing = doorLatestAccess.get(entry.door_id);
        if (!existing || new Date(entry.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
          doorLatestAccess.set(entry.door_id, {
            timestamp: entry.timestamp,
            userName: entry.user_name,
            accessMethod: entry.access_method,
            accessMethodLabel: entry.access_method_label,
          });
        }
      }
    }

    try {
      await chunkBatch.commit();
    } catch (err) {
      logger.error(`[AccessLogSync] Chunk write failed: ${String(err)}`);
    }
  }

  // 3. Update doors with last accessed metadata and update sync state
  const metaBatch = db.batch();
  for (const [doorId, info] of doorLatestAccess.entries()) {
    const doorRef = db.doc(`organizations/${orgId}/doors/${doorId}`);
    metaBatch.set(
      doorRef,
      {
        last_accessed_at: info.timestamp,
        last_accessed_by: info.userName,
        last_access_method: info.accessMethod,
        last_access_method_label: info.accessMethodLabel,
      },
      { merge: true }
    );
  }

  // 4. Update sync state
  _lastSyncedEpochSeconds = Math.max(_lastSyncedEpochSeconds, latestEventEpoch);
  const syncStateRef = db.doc(`organizations/${orgId}/settings/access_log_sync`);
  metaBatch.set(
    syncStateRef,
    {
      last_synced_epoch: _lastSyncedEpochSeconds,
      last_synced_at: now,
      total_synced: entries.length,
    },
    { merge: true }
  );

  try {
    await metaBatch.commit();
    logger.info(`[AccessLogSync] Successfully committed ${entries.length} access log(s) to Firestore for org: ${orgId}`);
  } catch (err) {
    logger.error(`[AccessLogSync] Metadata write failed: ${String(err)}`);
  }

  // 5. Capture event snapshots on linked cameras for recent door access events (once per log ID)
  if (options?.protectManager?.isConfigured() && entries.length > 0) {
    const nowMs = Date.now();
    const recentByDoor = new Map<string, AccessLogEntry>();
    for (const entry of entries) {
      if (!entry.id || !entry.door_id) continue;
      if (_capturedCameraEventLogIds.has(entry.id)) continue;
      const tsMs = Date.parse(entry.timestamp);
      if (isNaN(tsMs) || nowMs - tsMs > 2 * 60 * 1000) continue; // only fresh events (<2m old)
      if (!recentByDoor.has(entry.door_id)) {
        recentByDoor.set(entry.door_id, entry);
      }
    }
    for (const [doorId, entry] of recentByDoor.entries()) {
      trackBoundedLogId(_capturedCameraEventLogIds, entry.id);
      try {
        const doorSnap = await db.doc(`organizations/${orgId}/doors/${doorId}`).get();
        const doorData = doorSnap.exists ? doorSnap.data() : null;
        const linkedCamIds = Array.from(
          new Set(
            [
              doorData?.primary_camera_id,
              ...(Array.isArray(doorData?.camera_ids) ? doorData.camera_ids : []),
            ].filter((id): id is string => typeof id === 'string' && id.length > 0)
          )
        );
        if (linkedCamIds.length > 0) {
          const label = `${entry.user_name || 'Access'} · ${entry.access_method_label || entry.event_type}`;
          const allowEventLogPhotos = !entry.snapshot_skipped_reason;
          const capturedEntries: Array<{ camera_id: string; storage_path: string; captured_at: string }> = [];

          if (entry.snapshot_storage_path && entry.snapshot_camera_id) {
            capturedEntries.push({
              camera_id: entry.snapshot_camera_id,
              storage_path: entry.snapshot_storage_path,
              captured_at: entry.snapshot_captured_at || new Date().toISOString(),
            });
          }

          await Promise.all(
            linkedCamIds.map(async (camIdStr) => {
              const alreadyCapturedByRule =
                entry.snapshot_camera_id === camIdStr && Boolean(entry.snapshot_storage_path);
              const eventLogStoragePath =
                allowEventLogPhotos && !alreadyCapturedByRule
                  ? `organizations/${orgId}/cameras/${camIdStr}/unlock_events/${entry.id}.jpg`
                  : undefined;

              const captured = await captureCameraEventSnapshot(
                orgId,
                camIdStr,
                entry.event_type,
                label,
                options.protectManager!,
                true,
                eventLogStoragePath
              );
              if (captured && eventLogStoragePath) {
                capturedEntries.push({
                  camera_id: camIdStr,
                  storage_path: eventLogStoragePath,
                  captured_at: new Date().toISOString(),
                });
              }
            })
          );

          if (capturedEntries.length > 0) {
            // Preserve linkedCamIds order (primary camera first)
            capturedEntries.sort(
              (a, b) => linkedCamIds.indexOf(a.camera_id) - linkedCamIds.indexOf(b.camera_id)
            );
            const first = capturedEntries[0];
            const updatePayload: Record<string, unknown> = {
              snapshot_entries: capturedEntries,
            };
            if (!entry.snapshot_storage_path) {
              updatePayload.snapshot_storage_path = first.storage_path;
              updatePayload.snapshot_camera_id = first.camera_id;
              updatePayload.snapshot_captured_at = first.captured_at;
            }
            await db.doc(`organizations/${orgId}/access_logs/${entry.id}`).set(updatePayload, { merge: true });
          }
        }
      } catch {
        // non-fatal
      }
    }
  }

  return entries;
}

/**
 * Force a deep backfill of all historical access logs from UniFi into Firestore.
 */
export async function backfillAccessLogs(
  orgId: string,
  unifiClient: UnifiAccessClient,
  lookbackDays = 90
): Promise<AccessLogEntry[]> {
  return syncAccessLogs(orgId, unifiClient, {
    forceFull: true,
    lookbackDays,
    maxPages: 50,
  });
}

/**
 * Start a recurring access log sync on a fixed interval (e.g. every 3 seconds).
 */
export function startAccessLogSyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs = 3000,
  protectManager?: ProtectManager
): () => void {
  logger.info(
    `[AccessLogSync] Starting access log sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  // Initial sync after 3 seconds
  setTimeout(() => {
    syncAccessLogs(orgId, unifiClient, { protectManager }).catch((err) => {
      logger.error(`[AccessLogSync] Error in initial sync: ${String(err)}`);
    });
  }, 3000);

  const handle = setInterval(() => {
    syncAccessLogs(orgId, unifiClient, { protectManager }).catch((err) => {
      logger.error(`[AccessLogSync] Unhandled error in sync interval: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[AccessLogSync] Access log sync interval stopped.');
  };
}
