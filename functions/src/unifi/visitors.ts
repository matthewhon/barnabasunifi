import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { UnifiVisitor, VisitorStatus } from '../types';

// ---------------------------------------------------------------------------
// Helpers & Normalizers
// ---------------------------------------------------------------------------

export function normalizeUnifiVisitor(raw: any, orgId = ''): UnifiVisitor {
  const id = String(raw.id || raw.unique_id || raw.visitor_id || raw.user_id || raw._id || '');
  const firstName = String(raw.first_name || raw.firstName || (raw.name ? String(raw.name).split(' ')[0] : 'Visitor'));
  const lastName = String(raw.last_name || raw.lastName || (raw.name ? String(raw.name).split(' ').slice(1).join(' ') : ''));
  const fullName = String(raw.full_name || raw.name || `${firstName} ${lastName}`.trim());

  let startTimeIso = new Date().toISOString();
  if (raw.start_time || raw.startTime) {
    const val = raw.start_time || raw.startTime;
    if (typeof val === 'number') {
      startTimeIso = new Date(val > 10000000000 ? val : val * 1000).toISOString();
    } else {
      startTimeIso = new Date(val).toISOString();
    }
  }

  let endTimeIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  if (raw.end_time || raw.endTime) {
    const val = raw.end_time || raw.endTime;
    if (typeof val === 'number') {
      endTimeIso = new Date(val > 10000000000 ? val : val * 1000).toISOString();
    } else {
      endTimeIso = new Date(val).toISOString();
    }
  }

  const doorIds: string[] = [];
  const doorLabels: string[] = [];
  const rawDoors = raw.doors || raw.door_ids || raw.device_ids || raw.resources;
  if (Array.isArray(rawDoors)) {
    for (const d of rawDoors) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        const dId = d.id || d.unique_id || d.door_id;
        const dLabel = d.name || d.label;
        if (dId) doorIds.push(String(dId));
        if (dLabel) doorLabels.push(String(dLabel));
      }
    }
  }

  const now = Date.now();
  const startMs = new Date(startTimeIso).getTime();
  const endMs = new Date(endTimeIso).getTime();
  let status: VisitorStatus = 'active';
  if (raw.status === 'canceled' || raw.status === 'revoked') {
    status = 'revoked';
  } else if (now < startMs) {
    status = 'upcoming';
  } else if (now >= endMs) {
    status = 'expired';
  }

  return {
    id,
    org_id: orgId,
    unifi_visitor_id: id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    mobile_phone: raw.mobile_phone || raw.phone || '',
    email: raw.email || '',
    pin_code: raw.pin_code || raw.pin || raw.passcode || '',
    start_time: startTimeIso,
    end_time: endTimeIso,
    door_ids: doorIds,
    door_labels: doorLabels,
    status,
    purpose: raw.purpose || raw.note || raw.remarks || raw.visit_reason || '',
    raw_data: raw,
    last_synced: new Date().toISOString(),
    sync_status: 'synced',
  };
}

export function serializeUnifiVisitor(visitor: Partial<UnifiVisitor>): any {
  const base: Record<string, any> = visitor.raw_data ? { ...visitor.raw_data } : {};

  if (visitor.first_name) base.first_name = visitor.first_name;
  if (visitor.last_name !== undefined) base.last_name = visitor.last_name;
  if (visitor.mobile_phone !== undefined) base.mobile_phone = visitor.mobile_phone;
  if (visitor.email !== undefined) base.email = visitor.email;
  if (visitor.purpose !== undefined) {
    base.purpose = visitor.purpose;
    base.visit_reason = visitor.purpose || 'Other';
  }

  if (visitor.door_ids && visitor.door_ids.length > 0) {
    base.doors = visitor.door_ids;
    base.door_ids = visitor.door_ids;
    base.resources = visitor.door_ids.map((id) => ({
      id,
      type: 'door',
    }));
  }

  if (visitor.start_time) {
    const ms = new Date(visitor.start_time).getTime();
    base.start_time = Math.floor(ms / 1000);
    base.start_time_millis = ms;
  }

  if (visitor.end_time) {
    const ms = new Date(visitor.end_time).getTime();
    base.end_time = Math.floor(ms / 1000);
    base.end_time_millis = ms;
  }

  if (visitor.pin_code) {
    base.pin_code = String(visitor.pin_code);
    base.pin = String(visitor.pin_code);
  }

  return base;
}

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

// ---------------------------------------------------------------------------
// Callable Functions
// ---------------------------------------------------------------------------

/**
 * syncUnifiVisitors
 * Pulls existing visitors from UniFi Access.
 */
export const syncUnifiVisitors = onCall<{ orgId: string }>(
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

      let rawVisitors: any[] = [];

      try {
        const res = await client.get('/api/v1/developer/visitors');
        rawVisitors = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch {
        try {
          const res = await client.get('/proxy/access/integration/v1/developer/visitors');
          rawVisitors = Array.isArray(res.data?.data) ? res.data.data : [];
        } catch {
          const res = await client.get('/proxy/access/api/v2/visitors');
          rawVisitors = Array.isArray(res.data?.data) ? res.data.data : [];
        }
      }

      const normalizedVisitors = rawVisitors.map((item) => normalizeUnifiVisitor(item, orgId));
      const batch = db.batch();
      const now = FieldValue.serverTimestamp();

      for (const visitor of normalizedVisitors) {
        if (!visitor.id) continue;
        const ref = db.doc(`organizations/${orgId}/visitors/${visitor.id}`);
        const snap = await ref.get();
        const existingData = snap.exists ? snap.data() : {};

        batch.set(ref, {
          ...visitor,
          org_id: orgId,
          // Preserve existing PIN if remote did not return plaintext
          pin_code: visitor.pin_code || existingData?.pin_code || '',
          last_synced: now,
          sync_status: 'synced',
          sync_error: null,
          updated_at: now,
        }, { merge: true });
      }

      await batch.commit();

      return {
        success: true,
        mode: 'remote',
        count: normalizedVisitors.length,
      };
    }

    // Agent mode: Queue command for local agent
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'sync_visitors',
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

/**
 * saveUnifiVisitor
 * Creates or updates a visitor in UniFi Access.
 */
export const saveUnifiVisitor = onCall<{ orgId: string; visitor: Partial<UnifiVisitor> }>(
  async (request) => {
    const { orgId, visitor } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
    if (!visitor || !visitor.first_name) {
      throw new HttpsError('invalid-argument', 'Valid visitor data with first_name is required.');
    }
    if (!visitor.pin_code || !/^\d{4,8}$/.test(visitor.pin_code.trim())) {
      throw new HttpsError('invalid-argument', 'PIN code must be 4 to 8 numeric digits.');
    }
    if (!visitor.door_ids || visitor.door_ids.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one door must be selected.');
    }
    if (!visitor.start_time || !visitor.end_time) {
      throw new HttpsError('invalid-argument', 'Start time and end time are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

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

      const payload = serializeUnifiVisitor(visitor);
      let savedRaw: any;

      if (visitor.unifi_visitor_id || (visitor.id && !visitor.id.startsWith('vis_'))) {
        const uId = visitor.unifi_visitor_id || visitor.id!;
        try {
          const res = await client.put(`/api/v1/developer/visitors/${encodeURIComponent(uId)}`, payload);
          savedRaw = res.data?.data ?? { id: uId, ...payload };
        } catch {
          try {
            const res = await client.put(`/proxy/access/integration/v1/developer/visitors/${encodeURIComponent(uId)}`, payload);
            savedRaw = res.data?.data ?? { id: uId, ...payload };
          } catch {
            const res = await client.put(`/proxy/access/api/v2/visitor/${encodeURIComponent(uId)}`, payload);
            savedRaw = res.data?.data ?? { id: uId, ...payload };
          }
        }
      } else {
        // Create
        try {
          const res = await client.post('/api/v1/developer/visitors', payload);
          savedRaw = res.data?.data ?? payload;
        } catch {
          try {
            const res = await client.post('/proxy/access/integration/v1/developer/visitors', payload);
            savedRaw = res.data?.data ?? payload;
          } catch {
            const res = await client.post('/proxy/access/api/v2/visitors', payload);
            savedRaw = res.data?.data ?? payload;
          }
        }
      }

      const normalized = normalizeUnifiVisitor(savedRaw, orgId);
      const visitorDocId = visitor.id || normalized.id || db.collection(`organizations/${orgId}/visitors`).doc().id;

      const now = FieldValue.serverTimestamp();
      await db.doc(`organizations/${orgId}/visitors/${visitorDocId}`).set({
        ...normalized,
        id: visitorDocId,
        org_id: orgId,
        pin_code: visitor.pin_code, // Store entered plaintext PIN in Firestore
        last_synced: now,
        sync_status: 'synced',
        sync_error: null,
        updated_at: now,
      }, { merge: true });

      // Audit Log
      await db.collection(`organizations/${orgId}/audit_log`).add({
        action: visitor.id ? 'visitor_updated' : 'visitor_created',
        triggered_by: 'manual',
        actor_uid: request.auth?.uid ?? null,
        message: `Visitor ${visitor.first_name} ${visitor.last_name || ''} ${visitor.id ? 'updated' : 'created'} via remote UniFi.`,
        result: 'success',
        timestamp: now,
      });

      return {
        success: true,
        mode: 'remote',
        visitor: {
          ...normalized,
          id: visitorDocId,
          pin_code: visitor.pin_code,
        },
      };
    }

    // Agent mode: Store optimistic state in Firestore and queue command for local agent
    const targetVisitorId = visitor.id || db.collection(`organizations/${orgId}/visitors`).doc().id;
    const nowIso = new Date().toISOString();

    // Check if visitor already has an established UniFi ID
    let unifiVisitorId = visitor.unifi_visitor_id;
    if (!unifiVisitorId && visitor.id) {
      const existingSnap = await db.doc(`organizations/${orgId}/visitors/${visitor.id}`).get();
      if (existingSnap.exists) {
        unifiVisitorId = existingSnap.data()?.unifi_visitor_id;
      }
    }

    const pendingVisitor: Partial<UnifiVisitor> = {
      ...visitor,
      id: targetVisitorId,
      org_id: orgId,
      full_name: `${visitor.first_name} ${visitor.last_name || ''}`.trim(),
      sync_status: 'pending',
      updated_at: nowIso,
    };

    if (unifiVisitorId) {
      pendingVisitor.unifi_visitor_id = unifiVisitorId;
    }

    await db.doc(`organizations/${orgId}/visitors/${targetVisitorId}`).set(pendingVisitor, { merge: true });

    // Only dispatch update_visitor if we actually have a UniFi visitor ID; otherwise create
    const action = unifiVisitorId ? 'update_visitor' : 'create_visitor';

    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action,
      visitor_id: targetVisitorId,
      firestore_visitor_id: targetVisitorId,
      unifi_visitor_id: unifiVisitorId || null,
      visitor_data: {
        ...visitor,
        id: targetVisitorId,
        unifi_visitor_id: unifiVisitorId,
      },
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
      visitorId: targetVisitorId,
    };
  }
);

/**
 * deleteUnifiVisitor
 * Revokes / deletes a visitor from UniFi Access and updates Firestore.
 */
export const deleteUnifiVisitor = onCall<{ orgId: string; visitorId: string; unifiVisitorId?: string }>(
  async (request) => {
    const { orgId, visitorId, unifiVisitorId } = request.data ?? {};
    if (!orgId || !visitorId) {
      throw new HttpsError('invalid-argument', 'orgId and visitorId are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      const targetUniFiId = unifiVisitorId || visitorId;

      if (remoteConfig?.host && remoteConfig?.access_token) {
        const host = remoteConfig.host.replace(/\/$/, '');
        const agent = new https.Agent({ rejectUnauthorized: false });
        const client = axios.create({
          baseURL: host,
          httpsAgent: agent,
          headers: {
            'X-API-KEY': remoteConfig.access_token,
            Authorization: `Bearer ${remoteConfig.access_token}`,
          },
          timeout: 15000,
        });

        try {
          await client.delete(`/api/v1/developer/visitors/${encodeURIComponent(targetUniFiId)}`);
        } catch {
          try {
            await client.delete(`/proxy/access/integration/v1/developer/visitors/${encodeURIComponent(targetUniFiId)}`);
          } catch {
            try {
              await client.delete(`/proxy/access/api/v2/visitor/${encodeURIComponent(targetUniFiId)}`);
            } catch (err) {
              console.warn(`Could not delete visitor ${targetUniFiId} on remote host:`, err);
            }
          }
        }
      }

      await db.doc(`organizations/${orgId}/visitors/${visitorId}`).set({
        status: 'revoked',
        sync_status: 'synced',
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Audit Log
      await db.collection(`organizations/${orgId}/audit_log`).add({
        action: 'visitor_deleted',
        triggered_by: 'manual',
        actor_uid: request.auth?.uid ?? null,
        message: `Visitor ${visitorId} revoked.`,
        result: 'success',
        timestamp: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        mode: 'remote',
      };
    }

    // Agent mode: Queue command
    const nowIso = new Date().toISOString();
    await db.doc(`organizations/${orgId}/visitors/${visitorId}`).set({
      status: 'revoked',
      sync_status: 'pending',
      updated_at: nowIso,
    }, { merge: true });

    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'delete_visitor',
      visitor_id: visitorId,
      visitor_data: { unifi_visitor_id: unifiVisitorId || visitorId },
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
