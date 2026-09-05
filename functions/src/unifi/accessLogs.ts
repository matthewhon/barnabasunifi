import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { AccessLogEntry, AccessMethod } from '../types';

// ---------------------------------------------------------------------------
// Helpers & Normalizers
// ---------------------------------------------------------------------------

export function normalizeAccessLogEntry(raw: any, orgId = ''): AccessLogEntry {
  const id = String(raw.id || raw._id || raw.event_id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  // Parse timestamp
  let timestampIso = new Date().toISOString();
  const rawTs = raw.timestamp || raw.event_time || raw.created_at || raw.published;
  if (rawTs) {
    if (typeof rawTs === 'number') {
      timestampIso = new Date(rawTs > 10000000000 ? rawTs : rawTs * 1000).toISOString();
    } else {
      const parsed = new Date(rawTs).getTime();
      if (!isNaN(parsed)) timestampIso = new Date(parsed).toISOString();
    }
  }

  const source = raw.source || {};
  const event = source.event || raw.event || {};
  const actor = source.actor || raw.actor || raw.user || {};
  const auth = source.authentication || raw.authentication || {};
  const target = source.target || raw.target || raw.door || {};

  // Event Type
  const rawEventType = String(event.type || raw.event_type || raw.type || '').toLowerCase();
  let eventType: 'door_unlock' | 'door_open' | 'door_close' | 'access_denied' | string = 'door_unlock';
  if (rawEventType.includes('door.open') || rawEventType.includes('dps.open') || rawEventType.includes('open')) {
    eventType = 'door_open';
  } else if (rawEventType.includes('door.close') || rawEventType.includes('dps.close') || rawEventType.includes('close')) {
    eventType = 'door_close';
  } else if (rawEventType.includes('reject') || rawEventType.includes('denied') || rawEventType.includes('failed')) {
    eventType = 'access_denied';
  } else if (rawEventType.includes('unlock')) {
    eventType = 'door_unlock';
  }

  // Result
  const rawResult = String(event.result || raw.result || '').toUpperCase();
  const eventResult: 'success' | 'denied' | 'failed' =
    rawResult.includes('DENIED') || rawResult.includes('REJECT') || eventType === 'access_denied'
      ? 'denied'
      : rawResult.includes('FAIL')
      ? 'failed'
      : 'success';

  // Access Method
  const rawMethod = String(
    auth.credential_provider ||
    raw.credential_type ||
    raw.method ||
    raw.access_method ||
    event.type ||
    ''
  ).toLowerCase();

  let accessMethod: AccessMethod = 'unknown';
  let accessMethodLabel = 'Access Method';

  if (rawMethod.includes('card') || rawMethod.includes('nfc') || rawMethod.includes('rfid') || rawMethod.includes('fob')) {
    accessMethod = 'nfc_card';
    accessMethodLabel = 'Key Card / Fob';
  } else if (rawMethod.includes('pin') || rawMethod.includes('passcode') || rawMethod.includes('password')) {
    accessMethod = 'pin_code';
    accessMethodLabel = 'Keypad PIN';
  } else if (rawMethod.includes('mobile') || rawMethod.includes('bluetooth') || rawMethod.includes('bt') || rawMethod.includes('app')) {
    accessMethod = 'mobile_tap';
    accessMethodLabel = 'Mobile Tap';
  } else if (rawMethod.includes('wave') || rawMethod.includes('hand')) {
    accessMethod = 'hand_wave';
    accessMethodLabel = 'Hand Wave';
  } else if (rawMethod.includes('remote') || rawMethod.includes('manual') || rawMethod.includes('button')) {
    accessMethod = 'remote';
    accessMethodLabel = 'Remote Unlock';
  } else if (rawMethod.includes('face')) {
    accessMethod = 'face';
    accessMethodLabel = 'Face Recognition';
  } else if (rawMethod.includes('visitor') || rawMethod.includes('qr')) {
    accessMethod = 'visitor_pin';
    accessMethodLabel = 'Visitor PIN / QR';
  } else if (rawMethod.includes('schedule')) {
    accessMethod = 'schedule';
    accessMethodLabel = 'Schedule';
  }

  // User details
  const userName = String(
    actor.display_name ||
    actor.name ||
    actor.full_name ||
    raw.user_name ||
    (actor.id ? `User ${actor.id}` : 'Anonymous / Guest')
  ).trim();

  const userId = actor.id ? String(actor.id) : (raw.user_id ? String(raw.user_id) : undefined);
  const userType: 'user' | 'visitor' | 'admin' | 'unknown' =
    actor.type === 'visitor' ? 'visitor' : actor.type === 'admin' ? 'admin' : actor.type === 'user' ? 'user' : 'unknown';

  // Door details
  const doorId = String(target.id || raw.door_id || raw.unique_id || '');
  const doorLabel = String(target.display_name || target.name || raw.door_label || raw.door_name || 'Door');

  // Display message
  const displayMessage =
    event.display_message ||
    raw.display_message ||
    (eventType === 'door_open'
      ? `${doorLabel} opened`
      : eventType === 'door_close'
      ? `${doorLabel} closed`
      : eventResult === 'denied'
      ? `Access denied for ${userName} at ${doorLabel} (${accessMethodLabel})`
      : `${userName} opened ${doorLabel} via ${accessMethodLabel}`);

  return {
    id,
    org_id: orgId,
    timestamp: timestampIso,
    event_type: eventType,
    event_result: eventResult,
    door_id: doorId,
    door_label: doorLabel,
    user_id: userId,
    user_name: userName,
    user_type: userType,
    access_method: accessMethod,
    access_method_label: accessMethodLabel,
    display_message: displayMessage,
    raw_data: raw,
  };
}

async function verifyOrgPermission(
  auth: { uid: string; token: Record<string, unknown> } | undefined,
  orgId: string,
  allowedRoles: string[] = ['org_admin', 'manager', 'viewer']
) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const role = auth.token.role as string | undefined;
  const tokenOrgId = auth.token.orgId as string | undefined;

  if (role === 'super_admin') return;

  if (tokenOrgId === orgId && role && allowedRoles.includes(role)) {
    return;
  }

  const db = getFirestore();
  const userDoc = await db.doc(`users/${auth.uid}`).get();
  if (userDoc.exists) {
    const userData = userDoc.data();
    if (userData?.role === 'super_admin') return;
    const memberships = userData?.org_memberships;
    let membershipRole: string | undefined;
    if (Array.isArray(memberships)) {
      membershipRole = memberships.find((m: any) => m.org_id === orgId)?.role;
    } else if (memberships && typeof memberships === 'object') {
      membershipRole = memberships[orgId]?.role;
    }
    if (membershipRole && allowedRoles.includes(membershipRole)) {
      return;
    }
  }

  throw new HttpsError('permission-denied', 'You do not have permission for this organization.');
}

// ---------------------------------------------------------------------------
// Callable Functions
// ---------------------------------------------------------------------------

/**
 * syncUnifiAccessLogs
 * Triggers access logs synchronization from UniFi Access.
 */
export const syncUnifiAccessLogs = onCall<{ orgId: string; backfill?: boolean; days?: number }>(
  async (request) => {
    const { orgId, backfill, days } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager', 'viewer']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        throw new HttpsError('failed-precondition', 'Remote UniFi configuration missing host or access token.');
      }

      const host = remoteConfig.host.replace(/\/$/, '');
      const agent = new https.Agent({ rejectUnauthorized: false });
      const client = axios.create({
        baseURL: host,
        httpsAgent: agent,
        headers: {
          'X-API-KEY': remoteConfig.access_token,
          Authorization: `Bearer ${remoteConfig.access_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      let rawLogs: any[] = [];
      const lookbackSec = (days || 90) * 24 * 60 * 60;
      const sinceEpoch = Math.floor(Date.now() / 1000) - lookbackSec;

      try {
        const res = await client.post('/api/v1/developer/system/logs', {
          topic: 'door_openings',
          page_size: 100,
          since: sinceEpoch,
        });
        rawLogs = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch {
        try {
          const res = await client.post('/proxy/access/integration/v1/developer/system/logs', {
            topic: 'door_openings',
            page_size: 100,
            since: sinceEpoch,
          });
          rawLogs = Array.isArray(res.data?.data) ? res.data.data : [];
        } catch {
          try {
            const res = await client.get('/proxy/access/api/v2/activities', {
              params: { page_size: 100, since: sinceEpoch },
            });
            rawLogs = Array.isArray(res.data?.data) ? res.data.data : [];
          } catch (err) {
            console.warn('[SyncAccessLogs] Failed to fetch logs from remote UniFi host:', err);
          }
        }
      }

      const normalizedLogs = rawLogs.map((item) => normalizeAccessLogEntry(item, orgId));

      const CHUNK_SIZE = 400;
      for (let i = 0; i < normalizedLogs.length; i += CHUNK_SIZE) {
        const chunk = normalizedLogs.slice(i, i + CHUNK_SIZE);
        const batch = db.batch();
        for (const log of chunk) {
          const docRef = db.doc(`organizations/${orgId}/access_logs/${log.id}`);
          batch.set(docRef, {
            ...log,
            created_at: FieldValue.serverTimestamp(),
          }, { merge: true });

          if (log.door_id) {
            const doorRef = db.doc(`organizations/${orgId}/doors/${log.door_id}`);
            batch.set(doorRef, {
              last_accessed_at: log.timestamp,
              last_accessed_by: log.user_name || null,
              last_access_method: log.access_method_label,
            }, { merge: true });
          }
        }
        await batch.commit();
      }

      return {
        success: true,
        mode: 'remote',
        count: normalizedLogs.length,
        logs: normalizedLogs,
      };
    }

    // Agent mode: Queue command
    const nowIso = new Date().toISOString();
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'sync_access_logs',
      backfill: Boolean(backfill),
      days: typeof days === 'number' ? days : 90,
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);
