import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getOrgAdminEmails, getOrgEmailContext, sendOrgEmail } from './postmark';
import {
  buildDoorHeldAlertEmail,
  buildVisitorExpiringEmail,
} from './templates/advancedAlertEmails';

const HELD_UNLOCKED_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes
const VISITOR_EXPIRING_LEAD_MS = 4 * 60 * 60 * 1000; // 4 hours
const MULTI_DAY_MIN_MS = 12 * 60 * 60 * 1000; // Only remind for passes > 12h

/**
 * Scheduled Cloud Function: scheduledSecurityAndVisitorMonitor
 * Runs every 15 minutes to check:
 * 1. Doors held unlocked > 60m (or propped open while locked)
 * 2. Multi-day visitor passes expiring within 4 hours
 */
export const scheduledSecurityAndVisitorMonitor = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeoutSeconds: 180,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const orgsSnap = await db.collection('organizations').get();
    if (orgsSnap.empty) return;

    const nowMs = Date.now();

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      try {
        const orgCtx = await getOrgEmailContext(orgId);
        const checkDoors = Boolean(orgCtx.emailSettings.notify_on_door_held_open);
        const checkVisitors = Boolean(orgCtx.emailSettings.notify_on_visitor_expiring);
        if (!checkDoors && !checkVisitors) continue;

        let alertRecipients = orgCtx.emailSettings.alert_recipients || [];
        if (alertRecipients.length === 0) alertRecipients = await getOrgAdminEmails(orgId);

        // 1. Door Held Unlocked / Propped Open Check
        if (checkDoors && alertRecipients.length > 0) {
          const doorsSnap = await orgDoc.ref.collection('doors').get();
          for (const doorDoc of doorsSnap.docs) {
            const d = doorDoc.data();
            const doorLabel = String(d.label || doorDoc.id);
            const wasAlerted = Boolean(d.held_alert_sent);

            let reason = '';
            if (d.current_state === 'locked' && d.door_position_status === 'open') {
              reason = 'propped open while locked';
            } else if (d.is_held_unlocked) {
              const expMs = d.hold_unlock_expires_at ? new Date(String(d.hold_unlock_expires_at)).getTime() : 0;
              const unlockedMs = d.last_unlocked_at ? new Date(String(d.last_unlocked_at)).getTime() : 0;
              if (expMs && nowMs > expMs) {
                reason = 'still held unlocked past its scheduled hold expiration';
              } else if (unlockedMs && nowMs - unlockedMs > HELD_UNLOCKED_THRESHOLD_MS) {
                reason = 'held unlocked for over 60 minutes';
              }
            }

            if (reason && !wasAlerted) {
              const tmpl = buildDoorHeldAlertEmail({
                orgName: orgCtx.orgName,
                doorLabel,
                reason,
                timezone: orgCtx.timezone,
                portalUrl: orgCtx.portalUrl || undefined,
              });
              const res = await sendOrgEmail({ orgId, to: alertRecipients, ...tmpl });
              if (res.sent) {
                await doorDoc.ref.set({ held_alert_sent: true }, { merge: true });
              }
            } else if (!reason && wasAlerted) {
              await doorDoc.ref.set({ held_alert_sent: false }, { merge: true });
            }
          }
        }

        // 2. Expiring Multi-Day Visitor Passes
        if (checkVisitors) {
          const hostRecipients =
            orgCtx.emailSettings.visitor_host_recipients?.length
              ? orgCtx.emailSettings.visitor_host_recipients
              : alertRecipients;
          if (hostRecipients.length === 0) continue;

          const visitorsSnap = await orgDoc.ref
            .collection('visitors')
            .where('status', '==', 'active')
            .get();

          for (const vDoc of visitorsSnap.docs) {
            const v = vDoc.data();
            if (v.expiring_alert_sent) continue;
            const startMs = v.start_time ? new Date(String(v.start_time)).getTime() : 0;
            const endMs = v.end_time ? new Date(String(v.end_time)).getTime() : 0;
            if (!startMs || !endMs) continue;
            if (endMs - startMs < MULTI_DAY_MIN_MS) continue;

            const remaining = endMs - nowMs;
            if (remaining > 0 && remaining <= VISITOR_EXPIRING_LEAD_MS) {
              const tmpl = buildVisitorExpiringEmail({
                orgName: orgCtx.orgName,
                visitorName: String(v.full_name || `${v.first_name || ''} ${v.last_name || ''}`.trim() || 'Visitor'),
                endTime: String(v.end_time),
                timezone: orgCtx.timezone,
                doorLabels: Array.isArray(v.door_labels) ? (v.door_labels as string[]) : [],
                portalUrl: orgCtx.portalUrl || undefined,
              });
              const res = await sendOrgEmail({ orgId, to: hostRecipients, ...tmpl });
              if (res.sent) {
                await vDoc.ref.set({ expiring_alert_sent: true }, { merge: true });
              }
            }
          }
        }
      } catch (err) {
        console.error(`scheduledSecurityAndVisitorMonitor failed for org ${orgId}:`, err);
      }
    }
  }
);
