import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import axios from 'axios';
import {
  UnifiVisitor,
  VisitorPreset,
  VisitorRequest,
  VisitorRequestData,
} from '../types';
import {
  getOrgAdminEmails,
  getOrgEmailContext,
  sendOrgEmail,
} from '../notifications/postmark';
import {
  buildVisitorRequestApprovedRequesterEmail,
  buildVisitorRequestInviteEmail,
  buildVisitorRequestReceiptEmail,
  buildVisitorRequestRejectedRequesterEmail,
  buildVisitorRequestSubmittedAdminEmail,
  buildVisitorSyncFailedAdminEmail,
  buildVisitorFirstArrivalEmail,
} from '../notifications/templates/visitorEmails';
import {
  dispatchVisitorEmails,
  provisionUnifiVisitor,
  verifyOrgPermission,
} from './visitors';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateRandomPin(length = 6): string {
  const safeLength = Math.max(4, Math.min(8, length));
  const min = Math.pow(10, safeLength - 1);
  const max = Math.pow(10, safeLength) - 1;
  const asc = '0123456789';
  const desc = '9876543210';
  let pin = '';
  do {
    pin = crypto.randomInt(min, max + 1).toString();
  } while (
    asc.includes(pin) ||
    desc.includes(pin) ||
    new RegExp(`^(\\d)\\1{${safeLength - 1}}$`).test(pin)
  );
  return pin;
}

async function resolveDoorLabels(orgId: string, doorIds: string[]): Promise<string[]> {
  if (!doorIds || doorIds.length === 0) return [];
  const db = getFirestore();
  const doorsSnap = await db.collection(`organizations/${orgId}/doors`).get();
  const labelMap = new Map<string, string>();
  for (const d of doorsSnap.docs) {
    const data = d.data();
    const label = String(data.custom_label || data.label || data.name || d.id);
    labelMap.set(d.id, label);
  }
  return doorIds.map((id) => labelMap.get(id) || id);
}

async function sendSlackVisitorAlert(orgId: string, text: string): Promise<void> {
  try {
    const db = getFirestore();
    const settingsSnap = await db.doc(`organizations/${orgId}/settings/config`).get();
    const slackCfg = settingsSnap.data()?.notifications?.slack_webhook;
    if (!slackCfg?.enabled || !slackCfg?.webhook_url) return;
    await axios.post(slackCfg.webhook_url, {
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ],
    });
  } catch (err) {
    console.warn(`[VisitorRequests] Slack alert failed for org ${orgId}:`, err);
  }
}

/**
 * createVisitorRequestLink
 * Generates a tokenized visitor request form link and optionally emails it to the recipient.
 */
export const createVisitorRequestLink = onCall<{
  orgId: string;
  recipientEmail?: string;
  recipientName?: string;
  inviteNote?: string;
  expiresInDays?: number;
  sendEmail?: boolean;
  origin?: string;
}>(async (request) => {
  const {
    orgId,
    recipientEmail,
    recipientName,
    inviteNote,
    expiresInDays = 7,
    sendEmail = false,
    origin,
  } = request.data ?? {};

  if (!orgId) {
    throw new HttpsError('invalid-argument', 'orgId is required.');
  }

  await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

  const db = getFirestore();
  const rawToken = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const requestId = db.collection(`organizations/${orgId}/visitor_requests`).doc().id;
  const now = new Date();
  const safeDays = Math.max(1, Math.min(30, Number(expiresInDays) || 7));
  const expiresAt = new Date(now.getTime() + safeDays * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const reqDoc: VisitorRequest = {
    id: requestId,
    org_id: orgId,
    token_hash: tokenHash,
    status: 'invited',
    invited_by_uid: request.auth?.uid || '',
    invited_by_email: (request.auth?.token?.email as string | undefined) || '',
    ...(recipientEmail ? { recipient_email: recipientEmail.trim() } : {}),
    ...(recipientName ? { recipient_name: recipientName.trim() } : {}),
    ...(inviteNote ? { invite_note: inviteNote.trim() } : {}),
    expires_at: expiresAt,
    created_at: nowIso,
    updated_at: nowIso,
  };

  await Promise.all([
    db.doc(`organizations/${orgId}/visitor_requests/${requestId}`).set(reqDoc),
    db.doc(`visitor_request_tokens/${tokenHash}`).set({
      org_id: orgId,
      request_id: requestId,
      expires_at: expiresAt,
      created_at: nowIso,
    }),
  ]);

  const orgCtx = await getOrgEmailContext(orgId);
  const safeOrigin =
    typeof origin === 'string' && /^https?:\/\//i.test(origin.trim())
      ? origin.trim()
      : '';
  const baseUrl = (
    safeOrigin ||
    orgCtx.portalUrl ||
    'https://barnabasunifi--barnabasunfi.us-east4.hosted.app'
  ).replace(/\/$/, '');
  const requestUrl = `${baseUrl}/visitor-request/${rawToken}`;

  let emailSent = false;
  if (sendEmail && recipientEmail && recipientEmail.includes('@')) {
    const tmpl = buildVisitorRequestInviteEmail({
      orgName: orgCtx.orgName,
      recipientName: recipientName?.trim(),
      inviterEmail: reqDoc.invited_by_email,
      inviteNote: inviteNote?.trim(),
      requestUrl,
      expiresAt,
      timezone: orgCtx.timezone,
    });
    const res = await sendOrgEmail({
      orgId,
      to: recipientEmail.trim(),
      ...tmpl,
    });
    emailSent = res.sent;
  }

  await db.collection(`organizations/${orgId}/audit_log`).add({
    action: 'visitor_request_created',
    triggered_by: 'manual',
    actor_uid: request.auth?.uid ?? null,
    message: `Visitor request form link created${recipientEmail ? ` for ${recipientEmail}` : ''}.`,
    result: 'success',
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    requestId,
    requestUrl,
    expiresAt,
    emailSent,
  };
});

/**
 * getVisitorRequestByToken
 * Public callable to validate an invite token and return safe org metadata + door presets.
 */
export const getVisitorRequestByToken = onCall<{ token: string }>(
  { cors: true },
  async (request) => {
    const { token } = request.data ?? {};
    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'A valid request token is required.');
    }

    const db = getFirestore();
    const tokenHash = hashToken(token.trim());
    const tokenSnap = await db.doc(`visitor_request_tokens/${tokenHash}`).get();
    if (!tokenSnap.exists) {
      throw new HttpsError('not-found', 'This visitor request link is invalid.');
    }

    const { org_id: orgId, request_id: requestId } = tokenSnap.data() as {
      org_id: string;
      request_id: string;
    };

    const reqSnap = await db.doc(`organizations/${orgId}/visitor_requests/${requestId}`).get();
    if (!reqSnap.exists) {
      throw new HttpsError('not-found', 'Visitor request not found.');
    }

    const reqData = reqSnap.data() as VisitorRequest;
    if (reqData.status === 'expired' || new Date(reqData.expires_at).getTime() < Date.now()) {
      if (reqData.status === 'invited') {
        await reqSnap.ref.update({ status: 'expired', updated_at: new Date().toISOString() });
      }
      throw new HttpsError('failed-precondition', 'This visitor request link has expired.');
    }

    if (reqData.status !== 'invited') {
      return {
        alreadySubmitted: true,
        status: reqData.status,
      };
    }

    const [orgSnap, doorsSnap, presetsSnap] = await Promise.all([
      db.doc(`organizations/${orgId}`).get(),
      db.collection(`organizations/${orgId}/doors`).get(),
      db.doc(`organizations/${orgId}/settings/visitor_presets`).get(),
    ]);

    const orgData = orgSnap.exists ? orgSnap.data() : {};
    const doors = doorsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((d) => !d.hidden_from_non_admins && (d.custom_label || d.label || d.name))
      .map((d) => ({
        id: d.id,
        label: String(d.custom_label || d.label || d.name),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const presets: VisitorPreset[] = presetsSnap.exists && Array.isArray(presetsSnap.data()?.presets)
      ? presetsSnap.data()!.presets
      : [];

    return {
      alreadySubmitted: false,
      orgName: String(orgData?.name || 'Organization'),
      timezone: String(orgData?.timezone || 'America/Chicago'),
      recipientName: reqData.recipient_name || '',
      recipientEmail: reqData.recipient_email || '',
      inviteNote: reqData.invite_note || '',
      expiresAt: reqData.expires_at,
      doors,
      presets,
    };
  }
);

/**
 * submitVisitorRequest
 * Public callable for a requester to submit visitor information for approval.
 */
export const submitVisitorRequest = onCall<{
  token: string;
  requesterName: string;
  requesterEmail: string;
  visitorData: VisitorRequestData;
  website?: string; // Honeypot field
}>({ cors: true }, async (request) => {
  const { token, requesterName, requesterEmail, visitorData, website } = request.data ?? {};

  // Honeypot check: silently reject bots
  if (website && website.trim().length > 0) {
    return { success: true };
  }

  if (!token || !requesterName?.trim() || !requesterEmail?.includes('@')) {
    throw new HttpsError('invalid-argument', 'Requester name and valid email are required.');
  }
  if (
    !visitorData ||
    !visitorData.first_name?.trim() ||
    !visitorData.email?.includes('@') ||
    !visitorData.start_time ||
    !visitorData.end_time ||
    !visitorData.purpose?.trim()
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Visitor first name, valid email, purpose, start time, and end time are required.'
    );
  }

  const startMs = new Date(visitorData.start_time).getTime();
  const endMs = new Date(visitorData.end_time).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    throw new HttpsError('invalid-argument', 'End time must be after start time.');
  }

  const db = getFirestore();
  const tokenHash = hashToken(token.trim());
  const tokenSnap = await db.doc(`visitor_request_tokens/${tokenHash}`).get();
  if (!tokenSnap.exists) {
    throw new HttpsError('not-found', 'Invalid visitor request link.');
  }

  const { org_id: orgId, request_id: requestId } = tokenSnap.data() as {
    org_id: string;
    request_id: string;
  };

  const reqRef = db.doc(`organizations/${orgId}/visitor_requests/${requestId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'Visitor request not found.');
  }

  const reqDoc = reqSnap.data() as VisitorRequest;
  if (reqDoc.status !== 'invited') {
    throw new HttpsError('failed-precondition', 'This visitor request has already been submitted.');
  }
  if (new Date(reqDoc.expires_at).getTime() < Date.now()) {
    await reqRef.update({ status: 'expired', updated_at: new Date().toISOString() });
    throw new HttpsError('failed-precondition', 'This visitor request link has expired.');
  }

  const requestedDoorIds = Array.isArray(visitorData.requested_door_ids)
    ? visitorData.requested_door_ids
    : [];
  const requestedDoorLabels = await resolveDoorLabels(orgId, requestedDoorIds);
  const nowIso = new Date().toISOString();

  const sanitizedData: VisitorRequestData = {
    first_name: visitorData.first_name.trim(),
    last_name: visitorData.last_name?.trim() || '',
    email: visitorData.email.trim(),
    mobile_phone: visitorData.mobile_phone?.trim() || '',
    purpose: visitorData.purpose.trim(),
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    requested_door_ids: requestedDoorIds,
    requested_door_labels: requestedDoorLabels,
    ...(visitorData.preset_id ? { preset_id: visitorData.preset_id } : {}),
    ...(visitorData.preset_name ? { preset_name: visitorData.preset_name } : {}),
    ...(visitorData.notes ? { notes: visitorData.notes.trim() } : {}),
  };

  await reqRef.update({
    status: 'pending_approval',
    requester_name: requesterName.trim(),
    requester_email: requesterEmail.trim(),
    submitted_at: nowIso,
    visitor_data: sanitizedData,
    updated_at: nowIso,
  });

  const orgCtx = await getOrgEmailContext(orgId);
  const visitorName = `${sanitizedData.first_name} ${sanitizedData.last_name || ''}`.trim();
  const reviewUrl = orgCtx.portalUrl
    ? `${orgCtx.portalUrl.replace(/\/$/, '')}/visitors?tab=requests`
    : undefined;

  // Notify admins / host recipients
  let adminRecipients = orgCtx.emailSettings.visitor_host_recipients || [];
  if (adminRecipients.length === 0) {
    adminRecipients = await getOrgAdminEmails(orgId);
  }
  if (adminRecipients.length > 0) {
    const adminTmpl = buildVisitorRequestSubmittedAdminEmail({
      orgName: orgCtx.orgName,
      visitorName,
      visitorEmail: sanitizedData.email,
      requesterName: requesterName.trim(),
      requesterEmail: requesterEmail.trim(),
      startTime: sanitizedData.start_time,
      endTime: sanitizedData.end_time,
      purpose: sanitizedData.purpose,
      doorLabels: requestedDoorLabels,
      timezone: orgCtx.timezone,
      reviewUrl,
    });
    await sendOrgEmail({
      orgId,
      to: adminRecipients,
      ...adminTmpl,
    }).catch((err) => console.error('[VisitorRequests] Failed to notify admins:', err));
  }

  // Send receipt to requester
  const receiptTmpl = buildVisitorRequestReceiptEmail({
    orgName: orgCtx.orgName,
    requesterName: requesterName.trim(),
    visitorName,
    startTime: sanitizedData.start_time,
    endTime: sanitizedData.end_time,
    timezone: orgCtx.timezone,
  });
  await sendOrgEmail({
    orgId,
    to: requesterEmail.trim(),
    ...receiptTmpl,
  }).catch((err) => console.error('[VisitorRequests] Failed to send requester receipt:', err));

  await sendSlackVisitorAlert(
    orgId,
    `📋 *New Visitor Request* for *${orgCtx.orgName}*\n• *Visitor:* ${visitorName} (${sanitizedData.email})\n• *Requested by:* ${requesterName.trim()}\n• *Purpose:* ${sanitizedData.purpose}${reviewUrl ? `\n<${reviewUrl}|Review & Approve>` : ''}`
  );

  await db.collection(`organizations/${orgId}/audit_log`).add({
    action: 'visitor_request_submitted',
    triggered_by: 'public_form',
    message: `Visitor request submitted by ${requesterName.trim()} (${requesterEmail.trim()}) for ${visitorName}.`,
    result: 'success',
    timestamp: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/**
 * approveVisitorRequest
 * Approves a pending request (with any edits made by the approver), creates the UniFi visitor,
 * and sends timing + PIN to the visitor (either immediately or after agent sync completes).
 */
export const approveVisitorRequest = onCall<{
  orgId: string;
  requestId: string;
  visitor: Partial<UnifiVisitor>;
  sendEmail?: boolean;
  waitForSync?: boolean;
  reviewNotes?: string;
}>(async (request) => {
  const {
    orgId,
    requestId,
    visitor,
    sendEmail = true,
    waitForSync = true,
    reviewNotes,
  } = request.data ?? {};

  if (!orgId || !requestId) {
    throw new HttpsError('invalid-argument', 'orgId and requestId are required.');
  }

  await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

  const db = getFirestore();
  const reqRef = db.doc(`organizations/${orgId}/visitor_requests/${requestId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'Visitor request not found.');
  }

  const reqDoc = reqSnap.data() as VisitorRequest;
  if (reqDoc.status === 'approved') {
    throw new HttpsError('failed-precondition', 'This visitor request has already been approved.');
  }

  const pinCode = visitor?.pin_code?.trim() || generateRandomPin(6);
  const doorLabels =
    visitor?.door_labels && visitor.door_labels.length > 0
      ? visitor.door_labels
      : await resolveDoorLabels(orgId, visitor?.door_ids || []);

  const enrichedVisitor: Partial<UnifiVisitor> = {
    ...visitor,
    pin_code: pinCode,
    door_labels: doorLabels,
    request_id: requestId,
    ...(reqDoc.requester_email ? { requester_email: reqDoc.requester_email } : {}),
  };

  const result = await provisionUnifiVisitor({
    orgId,
    visitor: enrichedVisitor,
    sendEmail,
    waitForSync,
    actorUid: request.auth?.uid ?? null,
    actorEmail: request.auth?.token?.email as string | undefined,
  });

  const nowIso = new Date().toISOString();
  await reqRef.update({
    status: 'approved',
    visitor_id: result.visitorId,
    reviewed_by_uid: request.auth?.uid || '',
    reviewed_by_email: (request.auth?.token?.email as string | undefined) || '',
    reviewed_at: nowIso,
    ...(reviewNotes ? { review_notes: reviewNotes.trim() } : {}),
    updated_at: nowIso,
  });

  // Notify requester if not deferred to sync (or notify immediately with pendingSync note)
  if (reqDoc.requester_email && reqDoc.requester_email.includes('@')) {
    const orgCtx = await getOrgEmailContext(orgId);
    const visitorName = `${enrichedVisitor.first_name || ''} ${enrichedVisitor.last_name || ''}`.trim() || 'Visitor';
    const requesterTmpl = buildVisitorRequestApprovedRequesterEmail({
      orgName: orgCtx.orgName,
      requesterName: reqDoc.requester_name || 'there',
      visitorName,
      startTime: enrichedVisitor.start_time || nowIso,
      endTime: enrichedVisitor.end_time || nowIso,
      doorLabels,
      timezone: orgCtx.timezone,
      pendingSync: Boolean((result as any).deferredToSync),
    });
    await sendOrgEmail({
      orgId,
      to: reqDoc.requester_email,
      ...requesterTmpl,
    }).catch((err) => console.error('[VisitorRequests] Failed to notify requester:', err));
  }

  await db.collection(`organizations/${orgId}/audit_log`).add({
    action: 'visitor_request_approved',
    triggered_by: 'manual',
    actor_uid: request.auth?.uid ?? null,
    message: `Visitor request ${requestId} approved for ${enrichedVisitor.first_name} ${enrichedVisitor.last_name || ''}.`,
    result: 'success',
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    ...result,
    requestId,
  };
});

/**
 * rejectVisitorRequest
 * Marks a pending visitor request as rejected and optionally notifies the requester.
 */
export const rejectVisitorRequest = onCall<{
  orgId: string;
  requestId: string;
  reason?: string;
}>(async (request) => {
  const { orgId, requestId, reason } = request.data ?? {};
  if (!orgId || !requestId) {
    throw new HttpsError('invalid-argument', 'orgId and requestId are required.');
  }

  await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

  const db = getFirestore();
  const reqRef = db.doc(`organizations/${orgId}/visitor_requests/${requestId}`);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'Visitor request not found.');
  }

  const reqDoc = reqSnap.data() as VisitorRequest;
  const nowIso = new Date().toISOString();

  await reqRef.update({
    status: 'rejected',
    rejection_reason: reason?.trim() || '',
    reviewed_by_uid: request.auth?.uid || '',
    reviewed_by_email: (request.auth?.token?.email as string | undefined) || '',
    reviewed_at: nowIso,
    updated_at: nowIso,
  });

  if (reqDoc.requester_email && reqDoc.requester_email.includes('@')) {
    const orgCtx = await getOrgEmailContext(orgId);
    const visitorName = reqDoc.visitor_data
      ? `${reqDoc.visitor_data.first_name} ${reqDoc.visitor_data.last_name || ''}`.trim()
      : 'Visitor';
    const tmpl = buildVisitorRequestRejectedRequesterEmail({
      orgName: orgCtx.orgName,
      requesterName: reqDoc.requester_name || 'there',
      visitorName,
      reason: reason?.trim(),
    });
    await sendOrgEmail({
      orgId,
      to: reqDoc.requester_email,
      ...tmpl,
    }).catch((err) => console.error('[VisitorRequests] Failed to send rejection email:', err));
  }

  await db.collection(`organizations/${orgId}/audit_log`).add({
    action: 'visitor_request_rejected',
    triggered_by: 'manual',
    actor_uid: request.auth?.uid ?? null,
    message: `Visitor request ${requestId} rejected.${reason ? ` Reason: ${reason}` : ''}`,
    result: 'success',
    timestamp: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

/**
 * Firestore Trigger: onVisitorSyncedSendPass
 * In agent mode, when an approved visitor transitions to `sync_status === 'synced'`,
 * sends the visitor pass email (with PIN & .ics calendar invite). If it fails, alerts admins.
 */
export const onVisitorSyncedSendPass = onDocumentUpdated(
  'organizations/{orgId}/visitors/{visitorId}',
  async (event) => {
    const before = event.data?.before.data() as UnifiVisitor | undefined;
    const after = event.data?.after.data() as UnifiVisitor | undefined;
    if (!after || !after.send_pass_on_sync || after.pass_email_sent) {
      return;
    }

    const orgId = event.params.orgId;
    const visitorId = event.params.visitorId;
    const db = getFirestore();

    // Sync succeeded
    if (before?.sync_status !== 'synced' && after.sync_status === 'synced') {
      const sent = await dispatchVisitorEmails({
        orgId,
        visitor: { ...after, id: visitorId },
        isUpdate: false,
        sendEmail: true,
      }).catch(() => false);

      await db.doc(`organizations/${orgId}/visitors/${visitorId}`).update({
        send_pass_on_sync: false,
        pass_email_sent: sent,
        ...(sent ? { pass_email_sent_at: new Date().toISOString() } : {}),
      });
      return;
    }

    // Sync failed -> alert admins so they know the PIN was not sent
    if (before?.sync_status !== 'failed' && after.sync_status === 'failed') {
      const orgCtx = await getOrgEmailContext(orgId);
      const recipients = await getOrgAdminEmails(orgId);
      if (recipients.length > 0) {
        const visitorName = after.full_name || `${after.first_name} ${after.last_name || ''}`.trim();
        const tmpl = buildVisitorSyncFailedAdminEmail({
          orgName: orgCtx.orgName,
          visitorName,
          errorMessage: after.sync_error || 'Local agent failed to create visitor in UniFi Access.',
          portalUrl: orgCtx.portalUrl || undefined,
        });
        await sendOrgEmail({ orgId, to: recipients, ...tmpl }).catch(() => {});
      }
      await db.doc(`organizations/${orgId}/visitors/${visitorId}`).update({
        send_pass_on_sync: false,
      });
    }
  }
);

/**
 * Firestore Trigger: onVisitorFirstAccessLog
 * Notifies the original requester when a visitor unlocks a door for the first time.
 */
export const onVisitorFirstAccessLog = onDocumentCreated(
  'organizations/{orgId}/access_logs/{logId}',
  async (event) => {
    const logData = event.data?.data();
    if (!logData) return;
    if (logData.user_type !== 'visitor' || logData.event_result !== 'success') return;

    const orgId = event.params.orgId;
    const db = getFirestore();
    const visitorsSnap = await db
      .collection(`organizations/${orgId}/visitors`)
      .where('first_arrival_notified', '==', false)
      .get();

    // Also match visitors that don't have first_arrival_notified set yet if requester_email is present
    let matchedDoc = visitorsSnap.docs.find((d) => {
      const v = d.data();
      return (
        (logData.user_id && (v.unifi_visitor_id === logData.user_id || d.id === logData.user_id)) ||
        (logData.user_name && v.full_name && v.full_name.toLowerCase() === String(logData.user_name).toLowerCase())
      );
    });

    if (!matchedDoc) {
      const byRequesterSnap = await db
        .collection(`organizations/${orgId}/visitors`)
        .where('requester_email', '!=', '')
        .get();
      matchedDoc = byRequesterSnap.docs.find((d) => {
        const v = d.data();
        if (v.first_arrival_notified) return false;
        return (
          (logData.user_id && (v.unifi_visitor_id === logData.user_id || d.id === logData.user_id)) ||
          (logData.user_name && v.full_name && v.full_name.toLowerCase() === String(logData.user_name).toLowerCase())
        );
      });
    }

    if (!matchedDoc) return;
    const visitor = matchedDoc.data() as UnifiVisitor;
    if (!visitor.requester_email || !visitor.requester_email.includes('@')) return;

    const orgCtx = await getOrgEmailContext(orgId);
    const visitorName = visitor.full_name || `${visitor.first_name} ${visitor.last_name || ''}`.trim();
    const tmpl = buildVisitorFirstArrivalEmail({
      orgName: orgCtx.orgName,
      visitorName,
      doorLabel: String(logData.door_label || 'Facility Door'),
      arrivedAt: String(logData.timestamp || new Date().toISOString()),
      timezone: orgCtx.timezone,
    });

    await sendOrgEmail({
      orgId,
      to: visitor.requester_email,
      ...tmpl,
    }).catch(() => {});

    await matchedDoc.ref.update({ first_arrival_notified: true });
  }
);

/**
 * Scheduled Job: scheduledVisitorRequestMaintenance
 * Runs hourly to expire past-due requests and send reminders for pending requests starting within 2 hours.
 */
export const scheduledVisitorRequestMaintenance = onSchedule('every 1 hours', async () => {
  const db = getFirestore();
  const orgsSnap = await db.collection('organizations').get();
  const now = Date.now();
  const twoHoursMs = 2 * 60 * 60 * 1000;

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    const reqsSnap = await db
      .collection(`organizations/${orgId}/visitor_requests`)
      .where('status', 'in', ['invited', 'pending_approval'])
      .get();

    if (reqsSnap.empty) continue;

    for (const doc of reqsSnap.docs) {
      const req = doc.data() as VisitorRequest;
      const expiresMs = new Date(req.expires_at).getTime();
      const visitEndMs = req.visitor_data?.end_time ? new Date(req.visitor_data.end_time).getTime() : Infinity;

      if (now > expiresMs || now > visitEndMs) {
        await doc.ref.update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        });
        continue;
      }

      if (req.status === 'pending_approval' && !req.reminder_sent_at && req.visitor_data?.start_time) {
        const startMs = new Date(req.visitor_data.start_time).getTime();
        if (startMs - now <= twoHoursMs && startMs > now) {
          const orgCtx = await getOrgEmailContext(orgId);
          let recipients = orgCtx.emailSettings.visitor_host_recipients || [];
          if (recipients.length === 0) {
            recipients = await getOrgAdminEmails(orgId);
          }
          const visitorName = `${req.visitor_data.first_name} ${req.visitor_data.last_name || ''}`.trim();
          const reviewUrl = orgCtx.portalUrl
            ? `${orgCtx.portalUrl.replace(/\/$/, '')}/visitors?tab=requests`
            : undefined;

          if (recipients.length > 0) {
            const tmpl = buildVisitorRequestSubmittedAdminEmail({
              orgName: orgCtx.orgName,
              visitorName,
              visitorEmail: req.visitor_data.email,
              requesterName: req.requester_name || 'Requester',
              requesterEmail: req.requester_email || '',
              startTime: req.visitor_data.start_time,
              endTime: req.visitor_data.end_time,
              purpose: req.visitor_data.purpose,
              doorLabels: req.visitor_data.requested_door_labels || [],
              timezone: orgCtx.timezone,
              reviewUrl,
              isReminder: true,
            });
            await sendOrgEmail({ orgId, to: recipients, ...tmpl }).catch(() => {});
          }

          await sendSlackVisitorAlert(
            orgId,
            `⏰ *Reminder: Visitor Approval Needed Soon* (${orgCtx.orgName})\n• *Visitor:* ${visitorName}\n• *Starts in < 2 hours*${reviewUrl ? `\n<${reviewUrl}|Review Now>` : ''}`
          );

          await doc.ref.update({
            reminder_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }
});
