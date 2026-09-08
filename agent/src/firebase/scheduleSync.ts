/**
 * firebase/scheduleSync.ts
 * Syncs UniFi Access schedules into Firestore.
 *
 * Fetches all schedules from the local UniFi console and upserts them
 * into /organizations/{orgId}/unifi_schedules/{scheduleId}. Runs on startup
 * and on an interval to keep the cloud dashboard in sync with UniFi schedules.
 */

import { getDb } from '../firebase';
import { UnifiAccessClient, UnifiSchedule } from '../unifi/access';
import { logger } from '../logger';
import * as admin from 'firebase-admin';

/**
 * Fetch all schedules from UniFi Access and upsert into Firestore.
 */
export async function syncSchedules(
  orgId: string,
  unifiClient: UnifiAccessClient
): Promise<UnifiSchedule[]> {
  const db = getDb();
  let schedules: UnifiSchedule[] = [];

  try {
    schedules = await unifiClient.getSchedules();
  } catch (err) {
    logger.error(`[ScheduleSync] Failed to fetch schedules from UniFi: ${String(err)}`);
    return [];
  }

  if (schedules.length === 0) {
    logger.info('[ScheduleSync] No schedules returned from UniFi Access.');
    return [];
  }

  const isUuid = (str: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();
  const validScheduleIds = new Set<string>();

  for (const schedule of schedules) {
    if (!schedule.id) continue;
    const hasActiveSlots = schedule.weekly_schedule?.some((d) => d.active && d.slots.length > 0);
    if (!hasActiveSlots) continue;

    validScheduleIds.add(schedule.id);
    const scheduleRef = db.doc(`organizations/${orgId}/unifi_schedules/${schedule.id}`);

    const record = {
      ...schedule,
      org_id: orgId,
      last_synced: now,
      sync_status: 'synced',
      sync_error: null,
      updated_at: now,
    };

    batch.set(scheduleRef, record, { merge: true });

    // Link assigned doors directly in Firestore doors collection
    if (schedule.door_ids && Array.isArray(schedule.door_ids)) {
      for (const dId of schedule.door_ids) {
        const doorRef = db.doc(`organizations/${orgId}/doors/${dId}`);
        batch.set(
          doorRef,
          {
            schedule_id: schedule.id,
            schedule_name: schedule.name,
          },
          { merge: true }
        );
      }
    }
  }

  // Prune phantom, orphaned, or empty/inactive schedule documents in Firestore
  try {
    const existingSchedsSnap = await db.collection(`organizations/${orgId}/unifi_schedules`).get();
    let prunedSchedCount = 0;
    for (const docSnap of existingSchedsSnap.docs) {
      const docId = docSnap.id;
      const data = docSnap.data();
      const hasActiveSlots = Array.isArray(data.weekly_schedule) && data.weekly_schedule.some((d: any) => d.active && d.slots?.length > 0);

      // If document is not in valid schedules or has no active time windows
      if (!validScheduleIds.has(docId) || !hasActiveSlots) {
        batch.delete(docSnap.ref);
        prunedSchedCount++;
        logger.info(`[ScheduleSync] Pruning schedule ${docId} (name: "${data.name}")`);
      }
    }
    if (prunedSchedCount > 0) {
      logger.info(`[ScheduleSync] Pruned ${prunedSchedCount} empty/orphaned schedule document(s) from Firestore.`);
    }
  } catch (pruneErr) {
    logger.debug(`[ScheduleSync] Error during schedule pruning: ${pruneErr}`);
  }

  try {
    await batch.commit();
    logger.info(`[ScheduleSync] Synced ${schedules.length} schedule(s) for org: ${orgId}`);
  } catch (err) {
    logger.error(`[ScheduleSync] Batch write failed: ${String(err)}`);
  }

  return schedules;
}

/**
 * Start a recurring schedule sync on a fixed interval.
 * Returns a cleanup function that stops the interval.
 */
export function startScheduleSyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs: number
): () => void {
  logger.info(
    `[ScheduleSync] Starting schedule sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  const handle = setInterval(() => {
    syncSchedules(orgId, unifiClient).catch((err) => {
      logger.error(`[ScheduleSync] Unhandled error in schedule sync interval: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[ScheduleSync] Schedule sync interval stopped.');
  };
}
