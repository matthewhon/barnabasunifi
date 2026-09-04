/**
 * firebase/visitorSync.ts
 * Syncs UniFi Access visitors into Firestore.
 *
 * Fetches all visitors from the local UniFi console and upserts them
 * into /organizations/{orgId}/visitors/{visitorId}.
 */

import { getDb } from '../firebase';
import { UnifiAccessClient, UnifiVisitor } from '../unifi/access';
import { logger } from '../logger';
import * as admin from 'firebase-admin';

/**
 * Fetch all visitors from UniFi Access and upsert into Firestore.
 */
export async function syncVisitors(
  orgId: string,
  unifiClient: UnifiAccessClient
): Promise<UnifiVisitor[]> {
  const db = getDb();
  let visitors: UnifiVisitor[] = [];

  try {
    visitors = await unifiClient.getVisitors();
  } catch (err) {
    logger.error(`[VisitorSync] Failed to fetch visitors from UniFi: ${String(err)}`);
    return [];
  }

  if (visitors.length === 0) {
    logger.info('[VisitorSync] No visitors returned from UniFi Access.');
    return [];
  }

  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const visitor of visitors) {
    if (!visitor.id) continue;
    const visitorRef = db.doc(`organizations/${orgId}/visitors/${visitor.id}`);

    // Create payload, omitting undefined/null pin_code to avoid clearing existing PIN stored in Firestore
    const record: Record<string, any> = {
      id: visitor.id,
      org_id: orgId,
      unifi_visitor_id: visitor.unifi_visitor_id || visitor.id,
      first_name: visitor.first_name,
      last_name: visitor.last_name || '',
      full_name: visitor.full_name || `${visitor.first_name} ${visitor.last_name || ''}`.trim(),
      door_ids: visitor.door_ids || [],
      door_labels: visitor.door_labels || [],
      start_time: visitor.start_time,
      end_time: visitor.end_time,
      status: visitor.status || 'active',
      purpose: visitor.purpose || '',
      last_synced: now,
      sync_status: 'synced',
      sync_error: null,
      updated_at: now,
    };

    if (visitor.mobile_phone) record.mobile_phone = visitor.mobile_phone;
    if (visitor.email) record.email = visitor.email;
    if (visitor.pin_code) record.pin_code = visitor.pin_code;
    if (visitor.raw_data) {
      try {
        record.raw_data_json = JSON.stringify(visitor.raw_data);
      } catch {}
    }

    batch.set(visitorRef, record, { merge: true });
  }

  try {
    await batch.commit();
    logger.info(`[VisitorSync] Synced ${visitors.length} visitor(s) for org: ${orgId}`);
  } catch (err) {
    logger.error(`[VisitorSync] Batch write failed: ${String(err)}`);
  }

  return visitors;
}

/**
 * Start a recurring visitor sync on a fixed interval.
 */
export function startVisitorSyncInterval(
  orgId: string,
  unifiClient: UnifiAccessClient,
  intervalMs: number
): () => void {
  logger.info(
    `[VisitorSync] Starting visitor sync interval — every ${intervalMs / 1000}s for org: ${orgId}`
  );

  const handle = setInterval(() => {
    syncVisitors(orgId, unifiClient).catch((err) => {
      logger.error(`[VisitorSync] Unhandled error in visitor sync interval: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  return () => {
    clearInterval(handle);
    logger.info('[VisitorSync] Visitor sync interval stopped.');
  };
}
