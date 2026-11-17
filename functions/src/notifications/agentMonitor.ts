import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getOrgAdminEmails, getOrgEmailContext, sendOrgEmail } from './postmark';
import { buildAgentStatusEmail } from './templates/alertEmails';

const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

function toMillis(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  const ms = new Date(String(val)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Scheduled Cloud Function: scheduledAgentHealthMonitor
 * Runs every 15 minutes to detect offline local agents and send recovery emails
 * for organizations with `email_settings.notify_on_agent_offline` enabled.
 */
export const scheduledAgentHealthMonitor = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const orgsSnap = await db.collection('organizations').get();
    if (orgsSnap.empty) return;

    const now = Date.now();

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      try {
        const orgCtx = await getOrgEmailContext(orgId);
        if (!orgCtx.emailSettings.notify_on_agent_offline) continue;

        const agentsSnap = await orgDoc.ref.collection('agents').get();
        if (agentsSnap.empty) continue;

        let recipients = orgCtx.emailSettings.alert_recipients || [];
        if (recipients.length === 0) {
          recipients = await getOrgAdminEmails(orgId);
        }
        if (recipients.length === 0) continue;

        for (const agentDoc of agentsSnap.docs) {
          const data = agentDoc.data();
          const lastHbMs = toMillis(data.last_heartbeat);
          if (!lastHbMs) continue;

          const agentName = (data.name as string) || (data.hostname as string) || agentDoc.id;
          const isOffline = now - lastHbMs > OFFLINE_THRESHOLD_MS;
          const wasAlerted = Boolean(data.offline_alert_sent);

          if (isOffline && !wasAlerted) {
            const tmpl = buildAgentStatusEmail({
              orgName: orgCtx.orgName,
              agentName,
              isOffline: true,
              lastHeartbeat: new Date(lastHbMs).toISOString(),
              timezone: orgCtx.timezone,
              portalUrl: orgCtx.portalUrl || undefined,
            });
            const res = await sendOrgEmail({ orgId, to: recipients, ...tmpl });
            if (res.sent) {
              await agentDoc.ref.set({ offline_alert_sent: true }, { merge: true });
            }
          } else if (!isOffline && wasAlerted) {
            const tmpl = buildAgentStatusEmail({
              orgName: orgCtx.orgName,
              agentName,
              isOffline: false,
              lastHeartbeat: new Date(lastHbMs).toISOString(),
              timezone: orgCtx.timezone,
              portalUrl: orgCtx.portalUrl || undefined,
            });
            await sendOrgEmail({ orgId, to: recipients, ...tmpl });
            await agentDoc.ref.set({ offline_alert_sent: false }, { merge: true });
          }
        }
      } catch (err) {
        console.error(`scheduledAgentHealthMonitor failed for org ${orgId}:`, err);
      }
    }
  }
);
