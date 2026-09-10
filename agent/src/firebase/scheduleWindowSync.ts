/**
 * firebase/scheduleWindowSync.ts
 * Proactively caches upcoming schedule windows, org settings, and doors
 * to the local CacheStore for offline execution.
 */

import * as admin from 'firebase-admin';
import { getDb } from '../firebase';
import { logger } from '../logger';
import { getCacheStore, CachedScheduleWindow, CachedDoor } from '../storage/cacheStore';

/**
 * Safely parse a Firestore Timestamp, Date, or string into an ISO 8601 string.
 */
function toIsoString(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val.toDate === 'function') {
    return val.toDate().toISOString();
  }
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString();
  }
  if (typeof val === 'object' && ('_seconds' in val || 'seconds' in val)) {
    const sec = val._seconds ?? val.seconds;
    const nano = val._nanoseconds ?? val.nanoseconds ?? 0;
    return new Date(sec * 1000 + Math.floor(nano / 1000000)).toISOString();
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * One-shot sync of schedule windows, settings, and doors into local cache.
 */
export async function syncScheduleWindowsNow(orgId: string): Promise<number> {
  const db = getDb();
  const cacheStore = getCacheStore();
  cacheStore.setOrgId(orgId);

  try {
    // 1. Sync settings
    const settingsDoc = await db.doc(`organizations/${orgId}/settings/config`).get();
    if (settingsDoc.exists) {
      const data = settingsDoc.data() || {};
      const unifiConfig = data.unifi_agent || data.unifi_remote || {};
      cacheStore.updateSettings({
        timezone: data.timezone || 'UTC',
        unlock_buffer_before_min: data.unlock_buffer_before_min ?? 15,
        lock_buffer_after_min: data.lock_buffer_after_min ?? 15,
        lock_timing_mode: data.lock_timing_mode || 'after_end',
        lock_after_start_min: data.lock_after_start_min ?? 15,
        unifi_host: unifiConfig.host,
        unifi_access_token: unifiConfig.access_token,
        unifi_api_key: unifiConfig.api_key || unifiConfig.developer_api_key,
      });
    }

    // 2. Sync doors
    const doorsSnap = await db.collection(`organizations/${orgId}/doors`).get();
    const cachedDoors: CachedDoor[] = doorsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.label || d.name || doc.id,
        unifi_door_id: d.unifi_door_id || doc.id,
        current_state: d.current_state || 'unknown',
        is_held_unlocked: d.is_held_unlocked || false,
      };
    });
    cacheStore.updateDoors(cachedDoors);

    // 3. Sync schedule windows for the next 14 days (and windows from the last 2 hours to avoid dropping currently active events)
    const twoHoursAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);
    const fourteenDaysAhead = admin.firestore.Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const windowsSnap = await db
      .collection(`organizations/${orgId}/schedule_windows`)
      .where('lock_at', '>=', twoHoursAgo)
      .where('unlock_at', '<=', fourteenDaysAhead)
      .get();

    const cachedWindows: CachedScheduleWindow[] = [];
    for (const doc of windowsSnap.docs) {
      const d = doc.data();
      if (!d) continue;
      const doorIds = Array.isArray(d.door_ids) ? (d.door_ids as string[]) : [];
      if (doorIds.length === 0) continue;

      let doorTimings: Record<string, any> | undefined;
      if (d.door_timings && typeof d.door_timings === 'object') {
        doorTimings = {};
        for (const [doorId, t] of Object.entries(d.door_timings as Record<string, any>)) {
          if (t && typeof t === 'object') {
            doorTimings[doorId] = {
              unlock_at: toIsoString(t.unlock_at),
              lock_at: toIsoString(t.lock_at),
              unlock_offset_min: t.unlock_offset_min,
              lock_offset_min: t.lock_offset_min,
              lock_timing_mode: t.lock_timing_mode,
            };
          }
        }
      }

      cachedWindows.push({
        id: doc.id,
        org_id: orgId,
        source_label: String(d.source_label || d.title || 'Scheduled Window'),
        starts_at: toIsoString(d.starts_at),
        ends_at: toIsoString(d.ends_at),
        unlock_at: toIsoString(d.unlock_at),
        lock_at: toIsoString(d.lock_at),
        lock_timing_mode: d.lock_timing_mode,
        door_ids: doorIds,
        door_labels: Array.isArray(d.door_labels) ? (d.door_labels as string[]) : [],
        door_timings: doorTimings,
        status: d.status || 'pending',
      });
    }

    cacheStore.updateScheduleWindows(cachedWindows);
    logger.info(
      `[ScheduleWindowSync] Successfully synced ${cachedWindows.length} upcoming window(s) and ${cachedDoors.length} door(s) to local cache.`
    );
    return cachedWindows.length;
  } catch (err) {
    logger.warn(`[ScheduleWindowSync] One-shot sync notice: ${String(err)}`);
    return 0;
  }
}

/**
 * Start real-time listeners for schedule windows, settings, and doors.
 * Returns a cleanup function to unsubscribe listeners.
 */
export function startScheduleWindowSync(
  orgId: string,
  onCacheUpdated?: (count: number) => void
): () => void {
  const db = getDb();
  const cacheStore = getCacheStore();
  cacheStore.setOrgId(orgId);

  logger.info(`[ScheduleWindowSync] Starting proactive schedule caching for org: ${orgId}`);

  // Run initial one-shot sync immediately
  void syncScheduleWindowsNow(orgId).then((count) => {
    onCacheUpdated?.(count);
  });

  // 1. Settings listener
  const unsubSettings = db.doc(`organizations/${orgId}/settings/config`).onSnapshot(
    (snap) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      const unifiConfig = data.unifi_agent || data.unifi_remote || {};
      cacheStore.updateSettings({
        timezone: data.timezone || 'UTC',
        unlock_buffer_before_min: data.unlock_buffer_before_min ?? 15,
        lock_buffer_after_min: data.lock_buffer_after_min ?? 15,
        lock_timing_mode: data.lock_timing_mode || 'after_end',
        lock_after_start_min: data.lock_after_start_min ?? 15,
        unifi_host: unifiConfig.host,
        unifi_access_token: unifiConfig.access_token,
        unifi_api_key: unifiConfig.api_key || unifiConfig.developer_api_key,
      });
      logger.debug('[ScheduleWindowSync] Updated cached org settings.');
    },
    (err) => {
      logger.warn(`[ScheduleWindowSync] Settings listener notice: ${err.message}`);
    }
  );

  // 2. Doors listener
  const unsubDoors = db.collection(`organizations/${orgId}/doors`).onSnapshot(
    (snap) => {
      const cachedDoors: CachedDoor[] = snap.docs.map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.label || d.name || doc.id,
          unifi_door_id: d.unifi_door_id || doc.id,
          current_state: d.current_state || 'unknown',
          is_held_unlocked: d.is_held_unlocked || false,
        };
      });
      cacheStore.updateDoors(cachedDoors);
      logger.debug(`[ScheduleWindowSync] Updated ${cachedDoors.length} cached door(s).`);
    },
    (err) => {
      logger.warn(`[ScheduleWindowSync] Doors listener notice: ${err.message}`);
    }
  );

  // 3. Periodic recurring re-sync of schedule windows (every 5 minutes)
  // to slide the 14-day lookahead window forward as time advances
  const intervalHandle = setInterval(() => {
    syncScheduleWindowsNow(orgId)
      .then((count) => onCacheUpdated?.(count))
      .catch((err) => {
        logger.debug(`[ScheduleWindowSync] Periodic sync notice: ${err}`);
      });
  }, 5 * 60 * 1000);

  if (intervalHandle.unref) intervalHandle.unref();

  return () => {
    unsubSettings();
    unsubDoors();
    clearInterval(intervalHandle);
    logger.info('[ScheduleWindowSync] Proactive schedule caching stopped.');
  };
}
