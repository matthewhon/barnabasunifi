/**
 * firebase/doorSync.ts
 * Syncs UniFi Access door state into Firestore.
 *
 * Fetches all doors from the local UniFi console and upserts their current
 * state into /organizations/{orgId}/doors/{doorId}. Runs on an interval to
 * keep the cloud dashboard in sync with physical door states.
 */

import { getDb } from '../firebase';
import { UnifiAccessClient, UnifiDoor } from '../unifi/access';
import { logger } from '../logger';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NormalizedDoorState = 'locked' | 'unlocked' | 'unknown';

export interface DoorSyncRecord {
  unifi_door_id: string;
  label: string;
  current_state: NormalizedDoorState;
  door_position_status: string | null;
  device_state: string | null;
  is_held_unlocked?: boolean;
  hold_unlock_expires_at?: FirebaseFirestore.Timestamp | null;
  last_synced: FirebaseFirestore.Timestamp;
  org_id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map the UniFi `door_lock_relay_status` field to a normalized state string.
 */
function normalizeDoorState(
  relayStatus: UnifiDoor['door_lock_relay_status']
): NormalizedDoorState {
  switch (relayStatus) {
    case 'lock':
      return 'locked';
    case 'unlock':
      return 'unlocked';
    default:
      return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all doors from UniFi Access and upsert their state into Firestore.
 *
 * @param orgId       - Firestore organization document ID
 * @param unifiClient - Initialized UniFi Access API client
 */
export async function syncDoors(
  orgId: string,
  unifiClient: UnifiAccessClient
): Promise<void> {
  const db = getDb();
  let doors: UnifiDoor[];

  try {
    doors = await unifiClient.getDoors();
  } catch (err) {
    logger.error(`[DoorSync] Failed to fetch doors from UniFi: ${String(err)}`);
    return;
  }

  if (doors.length === 0) {
    logger.warn('[DoorSync] No doors returned from UniFi Access — nothing to sync.');
    return;
  }

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const door of doors) {
    const doorRef = db.doc(`organizations/${orgId}/doors/${door.id}`);

    const record: DoorSyncRecord = {
      unifi_door_id: door.id,
      label: door.full_name ?? door.name ?? door.id,
      current_state: normalizeDoorState(door.door_lock_relay_status),
      door_position_status: door.door_position_status ?? null,
      device_state: door.device_state ?? null,
      is_held_unlocked: Boolean(door.is_held_unlocked),
      hold_unlock_expires_at: typeof door.hold_unlock_end_time === 'number'
        ? admin.firestore.Timestamp.fromMillis(door.hold_unlock_end_time * 1000)
        : null,
      last_synced: now,
      org_id: orgId,
    };

    // set with merge:true so we don't overwrite fields managed by the web app
    batch.set(doorRef, record, { merge: true });
  }

  try {
    await batch.commit();
    logger.info(`[DoorSync] Synced ${doors.length} door(s) for org: ${orgId}`);
  } catch (err) {
    logger.error(`[DoorSync] Batch write failed: ${String(err)}`);
  }
}

/**
 * Start a recurring door sync on a fixed interval.
 *
 * Runs an initial sync immediately, then repeats every `intervalMs` ms.
 * Returns a cleanup function that stops the interval.
 *
 * @param orgId       - Firestore organization document ID
 * @param unifiClient - Initialized UniFi Access API client
 * @param intervalMs  - Sync frequency in milliseconds (default: 5 minutes)
 */
export function startDoorSyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs: number
): () => void {
  logger.info(
    `[DoorSync] Starting door sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  const handle = setInterval(() => {
    syncDoors(orgId, unifiClient).catch((err) => {
      logger.error(`[DoorSync] Unhandled error in sync interval: ${String(err)}`);
    });
  }, intervalMs);

  // Allow the Node.js process to exit even if this interval is active
  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[DoorSync] Door sync interval stopped.');
  };
}
