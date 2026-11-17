import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { UnifiVisitor, VisitorStatus } from '../types';
import { getOrgEmailContext, sendOrgEmail } from '../notifications/postmark';
import {
  buildVisitorPassEmail,
  buildVisitorHostAlertEmail,
  buildVisitorRevokedEmail,
  buildVisitorCalendarIcs,
} from '../notifications/templates/visitorEmails';

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

  let pinCode = '';
  const pinCandidate = raw.pin_code || raw.pin || raw.passcode;
  if (typeof pinCandidate === 'string') {
    pinCode = pinCandidate;
  } else if (typeof pinCandidate === 'number') {
    pinCode = String(pinCandidate);
  } else if (typeof pinCandidate === 'object' && pinCandidate !== null) {
    if (typeof pinCandidate.pin_code === 'string') pinCode = pinCandidate.pin_code;
    else if (typeof pinCandidate.pin === 'string') pinCode = pinCandidate.pin;
    else if (typeof pinCandidate.passcode === 'string') pinCode = pinCandidate.passcode;
  }

  return {
    id,
    org_id: orgId,
    unifi_visitor_id: id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    mobile_phone: typeof raw.mobile_phone === 'string' ? raw.mobile_phone : (typeof raw.phone === 'string' ? raw.phone : ''),
    email: typeof raw.email === 'string' ? raw.email : '',
    pin_code: pinCode,
    start_time: startTimeIso,
    end_time: endTimeIso,
    door_ids: doorIds,
    door_labels: doorLabels,
    status,
    purpose: typeof raw.purpose === 'string' ? raw.purpose : (typeof raw.note === 'string' ? raw.note : (typeof raw.remarks === 'string' ? raw.remarks : (typeof raw.visit_reason === 'string' ? raw.visit_reason : ''))),
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

export async function verifyOrgPermission(
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

      // Preload existing visitors for this org to prevent duplicate documents
      const existingSnap = await db.collection(`organizations/${orgId}/visitors`).get();
      const existingDocs = existingSnap.docs;

      for (const visitor of normalizedVisitors) {
        const unifiId = visitor.unifi_visitor_id || visitor.id;
        if (!unifiId && !visitor.first_name) continue;

        // Check if there is already a Firestore document with this unifi_visitor_id or matching record
        let targetDocId = unifiId;
        const existingMatch = existingDocs.find((d) => {
          const data = d.data();
          if (data.unifi_visitor_id === unifiId || d.id === unifiId) return true;
          if (
            data.first_name?.toLowerCase() === visitor.first_name?.toLowerCase() &&
            (data.last_name || '').toLowerCase() === (visitor.last_name || '').toLowerCase()
          ) {
            if (data.sync_status === 'pending') return true;
            if (data.start_time && visitor.start_time && data.start_time === visitor.start_time) return true;
          }
          return false;
        });

        if (existingMatch) {
          const existingData = existingMatch.data();
          if (existingData?.status === 'revoked') {
            // Do not revive revoked visitors into active
            continue;
          }
          targetDocId = existingMatch.id;
          if (existingMatch.id !== unifiId) {
            const orphanDoc = existingDocs.find((d) => d.id === unifiId);
            if (orphanDoc) {
              batch.delete(db.doc(`organizations/${orgId}/visitors/${unifiId}`));
            }
          }
        }

        if (!targetDocId) continue;
        const ref = db.doc(`organizations/${orgId}/visitors/${targetDocId}`);
        const existingData = existingMatch ? existingMatch.data() : {};

        batch.set(ref, {
          ...visitor,
          id: targetDocId,
          org_id: orgId,
          unifi_visitor_id: unifiId || targetDocId,
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

export async function dispatchVisitorEmails(params: {
  orgId: string;
  visitor: Partial<UnifiVisitor>;
  isUpdate: boolean;
  sendEmail?: boolean;
  actorEmail?: string;
}): Promise<boolean> {
  const { orgId, visitor, isUpdate, sendEmail, actorEmail } = params;
  const orgCtx = await getOrgEmailContext(orgId);
  const fullName = visitor.full_name || `${visitor.first_name || ''} ${visitor.last_name || ''}`.trim() || 'Visitor';

  let visitorEmailSent = false;

  if (sendEmail && visitor.email && visitor.email.includes('@')) {
    const emailData = {
      fullName,
      firstName: visitor.first_name,
      email: visitor.email,
      pinCode: visitor.pin_code,
      startTime: visitor.start_time || new Date().toISOString(),
      endTime: visitor.end_time || new Date().toISOString(),
      doorLabels: visitor.door_labels || [],
      purpose: visitor.purpose,
      timezone: orgCtx.timezone,
      orgName: orgCtx.orgName,
    };
    const tmpl = buildVisitorPassEmail(emailData, isUpdate);
    const icsAttachment = buildVisitorCalendarIcs({
      ...emailData,
      uid: visitor.id || visitor.unifi_visitor_id,
    });
    const res = await sendOrgEmail({
      orgId,
      to: visitor.email,
      ...tmpl,
      attachments: [icsAttachment],
    });
    visitorEmailSent = res.sent;
  }

  if (
    orgCtx.emailSettings.notify_on_visitor_host &&
    orgCtx.emailSettings.visitor_host_recipients &&
    orgCtx.emailSettings.visitor_host_recipients.length > 0
  ) {
    const hostTmpl = buildVisitorHostAlertEmail({
      fullName,
      firstName: visitor.first_name,
      email: visitor.email || '',
      pinCode: visitor.pin_code,
      startTime: visitor.start_time || new Date().toISOString(),
      endTime: visitor.end_time || new Date().toISOString(),
      doorLabels: visitor.door_labels || [],
      purpose: visitor.purpose,
      timezone: orgCtx.timezone,
      orgName: orgCtx.orgName,
      actorEmail,
      isUpdate,
    });
    await sendOrgEmail({
      orgId,
      to: orgCtx.emailSettings.visitor_host_recipients,
      ...hostTmpl,
    }).catch((err) => console.error('Failed to send visitor host alert:', err));
  }

  return visitorEmailSent;
}

export interface ProvisionVisitorParams {
  orgId: string;
  visitor: Partial<UnifiVisitor>;
  sendEmail?: boolean;
  waitForSync?: boolean;
  actorUid?: string | null;
  actorEmail?: string;
}

export async function provisionUnifiVisitor(params: ProvisionVisitorParams) {
  const { orgId, visitor, sendEmail, waitForSync, actorUid, actorEmail } = params;
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
    const emailSent = await dispatchVisitorEmails({
      orgId,
      visitor: { ...visitor, ...normalized, id: visitorDocId, pin_code: visitor.pin_code },
      isUpdate: Boolean(visitor.unifi_visitor_id || visitor.id),
      sendEmail,
      actorEmail,
    }).catch(() => false);

    await db.doc(`organizations/${orgId}/visitors/${visitorDocId}`).set({
      ...normalized,
      id: visitorDocId,
      org_id: orgId,
      pin_code: visitor.pin_code,
      ...(visitor.request_id ? { request_id: visitor.request_id } : {}),
      ...(visitor.requester_email ? { requester_email: visitor.requester_email } : {}),
      send_pass_on_sync: false,
      pass_email_sent: emailSent,
      ...(emailSent ? { pass_email_sent_at: new Date().toISOString() } : {}),
      last_synced: now,
      sync_status: 'synced',
      sync_error: null,
      updated_at: now,
    }, { merge: true });

    await db.collection(`organizations/${orgId}/audit_log`).add({
      action: visitor.id ? 'visitor_updated' : 'visitor_created',
      triggered_by: 'manual',
      actor_uid: actorUid ?? null,
      message: `Visitor ${visitor.first_name} ${visitor.last_name || ''} ${visitor.id ? 'updated' : 'created'} via remote UniFi.`,
      result: 'success',
      timestamp: now,
    });

    return {
      success: true,
      mode: 'remote' as const,
      emailSent,
      visitorId: visitorDocId,
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

  let unifiVisitorId = visitor.unifi_visitor_id;
  if (!unifiVisitorId && visitor.id) {
    const existingSnap = await db.doc(`organizations/${orgId}/visitors/${visitor.id}`).get();
    if (existingSnap.exists) {
      unifiVisitorId = existingSnap.data()?.unifi_visitor_id;
    }
  }

  const deferEmailToSync = Boolean(sendEmail && waitForSync && !unifiVisitorId);

  const pendingVisitor: Partial<UnifiVisitor> = {
    ...visitor,
    id: targetVisitorId,
    org_id: orgId,
    full_name: `${visitor.first_name} ${visitor.last_name || ''}`.trim(),
    sync_status: 'pending',
    send_pass_on_sync: deferEmailToSync,
    pass_email_sent: false,
    updated_at: nowIso,
  };

  if (unifiVisitorId) {
    pendingVisitor.unifi_visitor_id = unifiVisitorId;
  }

  let emailSent = false;
  if (!deferEmailToSync) {
    emailSent = await dispatchVisitorEmails({
      orgId,
      visitor: pendingVisitor,
      isUpdate: Boolean(unifiVisitorId),
      sendEmail,
      actorEmail,
    }).catch(() => false);
    if (emailSent) {
      pendingVisitor.pass_email_sent = true;
      pendingVisitor.pass_email_sent_at = nowIso;
    }
  }

  await db.doc(`organizations/${orgId}/visitors/${targetVisitorId}`).set(pendingVisitor, { merge: true });

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
    actor_uid: actorUid ?? null,
    created_at: nowIso,
    org_id: orgId,
  });

  return {
    success: true,
    mode: 'agent' as const,
    commandId: commandRef.id,
    visitorId: targetVisitorId,
    emailSent,
    deferredToSync: deferEmailToSync,
  };
}

/**
 * saveUnifiVisitor
 * Creates or updates a visitor in UniFi Access.
 */
export const saveUnifiVisitor = onCall<{ orgId: string; visitor: Partial<UnifiVisitor>; sendEmail?: boolean }>(
  async (request) => {
    const { orgId, visitor, sendEmail } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);
    return provisionUnifiVisitor({
      orgId,
      visitor,
      sendEmail,
      actorUid: request.auth?.uid ?? null,
      actorEmail: request.auth?.token?.email as string | undefined,
    });
  }
);

/**
 * sendVisitorPassEmail
 * Sends (or resends) the visitor access pass email with PIN and door details.
 */
export const sendVisitorPassEmail = onCall<{ orgId: string; visitorId: string }>(
  async (request) => {
    const { orgId, visitorId } = request.data ?? {};
    if (!orgId || !visitorId) {
      throw new HttpsError('invalid-argument', 'orgId and visitorId are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

    const db = getFirestore();
    const snap = await db.doc(`organizations/${orgId}/visitors/${visitorId}`).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Visitor not found.');
    }

    const visitor = snap.data() as UnifiVisitor;
    if (!visitor.email || !visitor.email.includes('@')) {
      throw new HttpsError('failed-precondition', 'Visitor does not have a valid email address.');
    }

    const orgCtx = await getOrgEmailContext(orgId);
    const emailData = {
      fullName: visitor.full_name || `${visitor.first_name} ${visitor.last_name || ''}`.trim(),
      firstName: visitor.first_name,
      email: visitor.email,
      pinCode: visitor.pin_code,
      startTime: visitor.start_time,
      endTime: visitor.end_time,
      doorLabels: visitor.door_labels || [],
      purpose: visitor.purpose,
      timezone: orgCtx.timezone,
      orgName: orgCtx.orgName,
    };
    const tmpl = buildVisitorPassEmail(emailData, false);
    const icsAttachment = buildVisitorCalendarIcs({
      ...emailData,
      uid: visitor.id || visitor.unifi_visitor_id,
    });

    const res = await sendOrgEmail({
      orgId,
      to: visitor.email,
      ...tmpl,
      attachments: [icsAttachment],
    });

    if (!res.sent) {
      throw new HttpsError('failed-precondition', res.error || 'Failed to send visitor pass email.');
    }

    return { success: true, messageId: res.messageIds?.[0] };
  }
);

/**
 * deleteUnifiVisitor
 * Revokes / deletes a visitor from UniFi Access and updates Firestore.
 */
export const deleteUnifiVisitor = onCall<{ orgId: string; visitorId: string; unifiVisitorId?: string; notifyVisitor?: boolean }>(
  async (request) => {
    const { orgId, visitorId, unifiVisitorId, notifyVisitor } = request.data ?? {};
    if (!orgId || !visitorId) {
      throw new HttpsError('invalid-argument', 'orgId and visitorId are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

    const db = getFirestore();
    const visitorDocRef = db.doc(`organizations/${orgId}/visitors/${visitorId}`);
    const visitorSnap = await visitorDocRef.get().catch(() => null);
    const visitorData = visitorSnap && visitorSnap.exists ? visitorSnap.data() : null;

    const resolvedUnifiId =
      unifiVisitorId ||
      (visitorData?.unifi_visitor_id as string) ||
      (visitorId.startsWith('vis_') ? '' : visitorId);

    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      const targetUniFiId = resolvedUnifiId || visitorId;

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

        if (targetUniFiId && !targetUniFiId.startsWith('vis_')) {
          const encId = encodeURIComponent(targetUniFiId);
          try {
            await client.delete(`/api/v1/developer/visitors/${encId}`);
          } catch {
            try {
              await client.delete(`/proxy/access/integration/v1/developer/visitors/${encId}`);
            } catch {
              try {
                await client.delete(`/proxy/access/api/v2/visitor/${encId}`);
              } catch {
                try {
                  await client.delete(`/proxy/access/api/v2/visitors/${encId}`);
                } catch {
                  try {
                    await client.post('/proxy/access/api/v2/visitors/batch_delete', { ids: [targetUniFiId] });
                  } catch {
                    try {
                      await client.post(`/proxy/access/api/v2/visitor/${encId}/revoke`, {});
                    } catch (err) {
                      console.warn(`Could not delete visitor ${targetUniFiId} on remote host:`, err);
                    }
                  }
                }
              }
            }
          }
        }
      }

      await visitorDocRef.set({
        status: 'revoked',
        sync_status: 'synced',
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Audit Log
      await db.collection(`organizations/${orgId}/audit_log`).add({
        action: 'visitor_deleted',
        triggered_by: 'manual',
        actor_uid: request.auth?.uid ?? null,
        message: `Visitor ${visitorData?.first_name || visitorId} (${visitorId}) revoked.`,
        result: 'success',
        timestamp: FieldValue.serverTimestamp(),
      });

      if (notifyVisitor && visitorData?.email) {
        const orgCtx = await getOrgEmailContext(orgId);
        const tmpl = buildVisitorRevokedEmail({
          fullName: visitorData.full_name || visitorData.first_name || 'Visitor',
          firstName: visitorData.first_name,
          orgName: orgCtx.orgName,
          startTime: visitorData.start_time || new Date().toISOString(),
          timezone: orgCtx.timezone,
        });
        await sendOrgEmail({ orgId, to: visitorData.email, ...tmpl }).catch(() => {});
      }

      return {
        success: true,
        mode: 'remote',
      };
    }

    // Agent mode: Queue command with rich visitor details
    const nowIso = new Date().toISOString();
    await visitorDocRef.set({
      status: 'revoked',
      sync_status: 'pending',
      updated_at: nowIso,
    }, { merge: true });

    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'delete_visitor',
      visitor_id: visitorId,
      unifi_visitor_id: resolvedUnifiId || null,
      visitor_data: {
        unifi_visitor_id: resolvedUnifiId || null,
        first_name: visitorData?.first_name || '',
        last_name: visitorData?.last_name || '',
        email: visitorData?.email || '',
        mobile_phone: visitorData?.mobile_phone || '',
        pin_code: visitorData?.pin_code || '',
      },
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: orgId,
    });

    // Audit Log
    await db.collection(`organizations/${orgId}/audit_log`).add({
      action: 'visitor_deleted',
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      message: `Visitor ${visitorData?.first_name || visitorId} (${visitorId}) deletion queued for agent.`,
      result: 'success',
      timestamp: FieldValue.serverTimestamp(),
    });

    if (notifyVisitor && visitorData?.email) {
      const orgCtx = await getOrgEmailContext(orgId);
      const tmpl = buildVisitorRevokedEmail({
        fullName: visitorData.full_name || visitorData.first_name || 'Visitor',
        firstName: visitorData.first_name,
        orgName: orgCtx.orgName,
        startTime: visitorData.start_time || new Date().toISOString(),
        timezone: orgCtx.timezone,
      });
      await sendOrgEmail({ orgId, to: visitorData.email, ...tmpl }).catch(() => {});
    }

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);
