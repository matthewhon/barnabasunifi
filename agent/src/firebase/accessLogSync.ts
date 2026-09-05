/**
 * firebase/accessLogSync.ts
 * Syncs UniFi Access door opening/closing activity & access methods into Firestore.
 *
 * Fetches access logs (user credentials, access method, timestamps, door open/close)
 * from UniFi Access and streams them into:
 * /organizations/{orgId}/access_logs/{logId}
 */

import { getDb } from '../firebase';
import { UnifiAccessClient, AccessLogEntry } from '../unifi/access';
import { logger } from '../logger';
import * as admin from 'firebase-admin';

let _lastSyncedEpochSeconds = 0;

export interface AccessLogSyncOptions {
  lookbackDays?: number;
  maxPages?: number;
  forceFull?: boolean;
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

  // 2. Commit logs to Firestore in safe chunks (max 400 operations per batch)
  const now = admin.firestore.Timestamp.now();
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
 * Start a recurring access log sync on a fixed interval (e.g. every 25 seconds).
 */
export function startAccessLogSyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs = 25000
): () => void {
  logger.info(
    `[AccessLogSync] Starting access log sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  // Initial sync after 3 seconds
  setTimeout(() => {
    syncAccessLogs(orgId, unifiClient).catch((err) => {
      logger.error(`[AccessLogSync] Error in initial sync: ${String(err)}`);
    });
  }, 3000);

  const handle = setInterval(() => {
    syncAccessLogs(orgId, unifiClient).catch((err) => {
      logger.error(`[AccessLogSync] Unhandled error in sync interval: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[AccessLogSync] Access log sync interval stopped.');
  };
}
