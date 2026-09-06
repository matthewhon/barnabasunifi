import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifyOrgPermission(
  auth: { uid: string; token: Record<string, unknown> } | undefined,
  orgId: string,
  allowedRoles: string[] = ['org_admin', 'manager']
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

function normalizeDoorState(relayStatus: string | undefined): 'locked' | 'unlocked' | 'unknown' {
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
// Cloud Functions
// ---------------------------------------------------------------------------

/**
 * syncUnifiDoors
 * Scans UniFi Access for doors and syncs them to Firestore.
 * Direct remote execution in remote mode, or queues agent command if in agent mode.
 */
export const syncUnifiDoors = onCall<{ orgId: string }>(
  async (request) => {
    const { orgId } = request.data ?? {};
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

      let rawDoors: any[] = [];
      try {
        const res = await client.get('/proxy/access/integration/v1/developer/doors');
        rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch {
        try {
          const res = await client.get('/api/v1/developer/doors');
          rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
        } catch {
          try {
            const res = await client.get('/proxy/access/api/v2/devices/doors');
            rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
          } catch {
            rawDoors = [];
          }
        }
      }

      const batch = db.batch();
      const now = FieldValue.serverTimestamp();

      for (const door of rawDoors) {
        const doorId = String(door.id || door.unique_id || '');
        if (!doorId) continue;

        const doorRef = db.doc(`organizations/${orgId}/doors/${doorId}`);
        const record: Record<string, any> = {
          unifi_door_id: doorId,
          label: door.full_name ?? door.name ?? doorId,
          current_state: normalizeDoorState(door.door_lock_relay_status),
          door_position_status: door.door_position_status ?? null,
          device_state: door.device_state ?? null,
          is_held_unlocked: Boolean(door.is_held_unlocked),
          last_synced: now,
          org_id: orgId,
        };

        const schedId = door.unlock_schedule_id || door.schedule_id;
        if (schedId) {
          record.schedule_id = String(schedId);
        }
        if (door.schedule_name) {
          record.schedule_name = String(door.schedule_name);
        }

        batch.set(doorRef, record, { merge: true });
      }

      await batch.commit();

      return {
        success: true,
        mode: 'remote',
        count: rawDoors.length,
      };
    }

    // Agent mode: Queue command for local agent
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'sync_doors',
      status: 'queued',
      execute_at: new Date().toISOString(),
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: new Date().toISOString(),
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);
