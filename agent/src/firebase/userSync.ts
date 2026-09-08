/**
 * firebase/userSync.ts
 * Syncs UniFi Access policies and local users into Firestore.
 */

import { getDb } from '../firebase';
import { UnifiAccessClient } from '../unifi/access';
import { logger } from '../logger';
import * as admin from 'firebase-admin';

function cleanFirestoreRecord<T extends Record<string, any>>(obj: T): T {
  const clean = (val: any): any => {
    if (val === undefined) return null;
    if (val === null || typeof val !== 'object') return val;
    if (val instanceof Date) return val.toISOString();
    if (Array.isArray(val)) {
      return val.filter((item) => item !== undefined).map(clean);
    }
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        res[k] = clean(v);
      }
    }
    return res;
  };
  return clean(obj);
}

/**
 * Fetch all access policies from UniFi Access and upsert into Firestore.
 */
export async function syncAccessPolicies(
  orgId: string,
  unifiClient: UnifiAccessClient
): Promise<any[]> {
  const db = getDb();
  let policies: any[] = [];

  try {
    policies = await unifiClient.getAccessPolicies();
  } catch (err) {
    logger.error(`[PolicySync] Failed to fetch access policies from UniFi: ${String(err)}`);
    return [];
  }

  if (policies.length === 0) {
    logger.info('[PolicySync] No access policies returned from UniFi Access.');
    return [];
  }

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const policy of policies) {
    if (!policy.id) continue;
    const policyRef = db.doc(`organizations/${orgId}/access_policies/${policy.id}`);

    const record = cleanFirestoreRecord({
      ...policy,
      org_id: orgId,
      last_synced: now,
      updated_at: now,
    });

    batch.set(policyRef, record, { merge: true });
  }

  try {
    await batch.commit();
    logger.info(`[PolicySync] ✓ Upserted ${policies.length} access policy(ies) into Firestore.`);
  } catch (err) {
    logger.error(`[PolicySync] Failed to commit access policies batch to Firestore: ${String(err)}`);
  }

  return policies;
}

/**
 * Start a recurring access policy sync on a fixed interval.
 * Returns a cleanup function that stops the interval.
 */
export function startPolicySyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs: number
): () => void {
  logger.info(
    `[PolicySync] Starting access policy sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  const handle = setInterval(() => {
    syncAccessPolicies(orgId, unifiClient).catch((err) => {
      logger.error(`[PolicySync] Unhandled error in policy sync interval: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[PolicySync] Access policy sync interval stopped.');
  };
}

/**
 * Fetch all users from UniFi Access and upsert into Firestore unifi_users.
 */
export async function syncUsers(
  orgId: string,
  unifiClient: UnifiAccessClient
): Promise<any[]> {
  const db = getDb();
  let users: any[] = [];

  try {
    users = await unifiClient.getUsers();
  } catch (err) {
    logger.error(`[UserSync] Failed to fetch users from UniFi: ${String(err)}`);
    return [];
  }

  if (users.length === 0) {
    logger.info('[UserSync] No users returned from UniFi Access.');
    return [];
  }

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const user of users) {
    if (!user.id) continue;
    const userRef = db.doc(`organizations/${orgId}/unifi_users/${user.id}`);

    const record = cleanFirestoreRecord({
      ...user,
      org_id: orgId,
      last_synced: now,
      updated_at: now,
    });

    batch.set(userRef, record, { merge: true });
  }

  try {
    await batch.commit();
    logger.info(`[UserSync] ✓ Upserted ${users.length} UniFi user(s) into Firestore.`);
  } catch (err) {
    logger.error(`[UserSync] Failed to commit users batch to Firestore: ${String(err)}`);
  }

  return users;
}
