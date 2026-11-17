import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getOrgAdminEmails, getOrgEmailContext, sendOrgEmail } from './postmark';
import {
  buildDeniedAccessAlertEmail,
  buildVisitorArrivalEmail,
} from './templates/advancedAlertEmails';

/**
 * Firestore Trigger: onAccessLogCreated
 * Handles opt-in alerts when new UniFi Access log entries arrive:
 * 1. `notify_on_denied_access`: alerts admins on denied/failed access attempts.
 * 2. `notify_on_visitor_arrival`: alerts host/staff on a visitor's first door unlock.
 */
export const onAccessLogCreated = onDocumentCreated(
  'organizations/{orgId}/access_logs/{logId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const orgId = event.params.orgId;
    const orgCtx = await getOrgEmailContext(orgId);
    const checkDenied = Boolean(orgCtx.emailSettings.notify_on_denied_access);
    const checkVisitorArrival = Boolean(orgCtx.emailSettings.notify_on_visitor_arrival);
    if (!checkDenied && !checkVisitorArrival) return;

    const resultStr = String(data.result || data.access_result || data.status || '').toLowerCase();
    const eventTypeStr = String(data.event_type || data.event || '').toLowerCase();
    const isDenied =
      resultStr.includes('denied') ||
      resultStr.includes('fail') ||
      resultStr.includes('unauthorized') ||
      eventTypeStr.includes('denied');

    const actorName = String(data.actor_name || data.user_name || data.display_name || 'Unknown');
    const doorLabel = String(data.door_name || data.door_label || data.door_id || 'Facility Door');
    const occurredAt = String(data.timestamp || data.created_at || new Date().toISOString());

    if (checkDenied && isDenied) {
      let recipients = orgCtx.emailSettings.alert_recipients || [];
      if (recipients.length === 0) recipients = await getOrgAdminEmails(orgId);
      if (recipients.length > 0) {
        const tmpl = buildDeniedAccessAlertEmail({
          orgName: orgCtx.orgName,
          actorName,
          doorLabel,
          method: data.access_method ? String(data.access_method) : undefined,
          occurredAt,
          timezone: orgCtx.timezone,
          portalUrl: orgCtx.portalUrl || undefined,
        });
        await sendOrgEmail({ orgId, to: recipients, ...tmpl });
      }
      return;
    }

    if (checkVisitorArrival && !isDenied) {
      const userType = String(data.user_type || data.actor_type || '').toLowerCase();
      const visitorId = data.visitor_id ? String(data.visitor_id) : '';
      if (!visitorId && userType !== 'visitor') return;

      const db = getFirestore();
      let visitorDoc = visitorId
        ? await db.doc(`organizations/${orgId}/visitors/${visitorId}`).get()
        : null;

      if (!visitorDoc || !visitorDoc.exists) {
        const activeSnap = await db
          .collection(`organizations/${orgId}/visitors`)
          .where('status', '==', 'active')
          .get();
        const match = activeSnap.docs.find((d) => {
          const v = d.data();
          if (visitorId && (v.unifi_visitor_id === visitorId || d.id === visitorId)) return true;
          const full = String(v.full_name || `${v.first_name || ''} ${v.last_name || ''}`.trim()).toLowerCase();
          return full && full === actorName.toLowerCase();
        });
        visitorDoc = match || null;
      }

      if (!visitorDoc || !visitorDoc.exists) return;
      const vData = visitorDoc.data()!;
      if (vData.arrival_alert_sent) return;

      let recipients = orgCtx.emailSettings.visitor_host_recipients || orgCtx.emailSettings.alert_recipients || [];
      if (recipients.length === 0) recipients = await getOrgAdminEmails(orgId);
      if (recipients.length === 0) return;

      const tmpl = buildVisitorArrivalEmail({
        orgName: orgCtx.orgName,
        visitorName: String(vData.full_name || actorName),
        doorLabel,
        arrivedAt: occurredAt,
        timezone: orgCtx.timezone,
        purpose: vData.purpose ? String(vData.purpose) : undefined,
      });
      const res = await sendOrgEmail({ orgId, to: recipients, ...tmpl });
      if (res.sent) {
        await visitorDoc.ref.set({ arrival_alert_sent: true }, { merge: true });
      }
    }
  }
);
