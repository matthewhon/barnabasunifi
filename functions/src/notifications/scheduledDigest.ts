import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { sendSlackUnmappedEventAlert } from './slack';
import { getOrgEmailContext, sendOrgEmail } from './postmark';
import { buildUnmappedEventsEmail } from './templates/eventEmails';

/**
 * Scheduled Cloud Function: scheduledEventReviewDigest
 *
 * Runs daily at 8:00 AM UTC (or configured time).
 * Checks all organizations for upcoming unmapped events and sends notifications if enabled.
 */
export const scheduledEventReviewDigest = onSchedule(
  {
    schedule: '0 8 * * *', // Daily at 8:00 AM
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async (_event) => {
    const db = getFirestore();
    const orgsSnap = await db.collection('organizations').get();

    if (orgsSnap.empty) return;

    const now = Date.now();

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      const orgData = orgDoc.data();
      const orgName = orgData.name || orgId;

      try {
        const configSnap = await orgDoc.ref.collection('settings').doc('config').get();
        if (!configSnap.exists) continue;

        const config = configSnap.data();
        const settings = config?.event_notifications;

        if (!settings || !settings.enabled) continue;

        const leadDays = settings.lead_days || 14;
        const maxFutureMs = now + leadDays * 24 * 60 * 60 * 1000;

        // Fetch unmapped schedule windows
        const windowsSnap = await orgDoc.ref.collection('schedule_windows')
          .where('starts_at', '>=', Timestamp.fromMillis(now))
          .get();

        const unmappedWindows = windowsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((w: any) => {
            const startMs = w.starts_at ? w.starts_at.toMillis() : 0;
            if (startMs > maxFutureMs) return false;
            if (w.status === 'cancelled') return false;
            if (w.review_status === 'dismissed') return false;
            return !w.door_ids || w.door_ids.length === 0;
          });

        if (unmappedWindows.length === 0) continue;

        const urgentEvents = unmappedWindows
          .filter((w: any) => {
            const startMs = w.starts_at ? w.starts_at.toMillis() : 0;
            return startMs - now <= 48 * 60 * 60 * 1000;
          })
          .map((w: any) => ({
            title: w.source_label || 'PCO Event',
            startsAt: new Date(w.starts_at.toMillis()).toLocaleString(),
            sourceType: w.source_type || 'service',
          }));

        // 1. Dispatch Slack Webhook if configured
        if (settings.channels?.slack_webhook?.enabled && settings.channels?.slack_webhook?.webhook_url) {
          await sendSlackUnmappedEventAlert({
            webhookUrl: settings.channels.slack_webhook.webhook_url,
            orgName,
            unmappedCount: unmappedWindows.length,
            urgentEvents,
          });
        }

        // 2. Dispatch Email Digest via Postmark if configured
        const emailCfg = settings.channels?.email;
        const emailMode = emailCfg?.mode || 'daily_digest';
        const isWeeklyMatch =
          emailMode === 'weekly_digest' &&
          new Date(now).getUTCDay() === (typeof emailCfg?.weekly_day === 'number' ? emailCfg.weekly_day : 1);
        const shouldSendDigestEmail = emailMode === 'daily_digest' || isWeeklyMatch;

        if (emailCfg?.enabled && shouldSendDigestEmail && Array.isArray(emailCfg.recipients) && emailCfg.recipients.length > 0) {
          const orgCtx = await getOrgEmailContext(orgId);
          const toIso = (val: any) =>
            val && typeof val.toMillis === 'function' ? new Date(val.toMillis()).toISOString() : String(val || '');

          const urgentList = unmappedWindows
            .filter((w: any) => {
              const startMs = w.starts_at ? w.starts_at.toMillis() : 0;
              return startMs - now <= 48 * 60 * 60 * 1000;
            })
            .map((w: any) => ({
              title: w.source_label || 'PCO Event',
              startsAt: toIso(w.starts_at),
              sourceType: w.source_type || 'service',
            }));

          const upcomingList = unmappedWindows
            .filter((w: any) => {
              const startMs = w.starts_at ? w.starts_at.toMillis() : 0;
              return startMs - now > 48 * 60 * 60 * 1000;
            })
            .map((w: any) => ({
              title: w.source_label || 'PCO Event',
              startsAt: toIso(w.starts_at),
              sourceType: w.source_type || 'service',
            }));

          const reviewUrl = orgCtx.portalUrl ? `${orgCtx.portalUrl}/events/unmapped` : undefined;
          const tmpl = buildUnmappedEventsEmail({
            orgName: orgCtx.orgName,
            unmappedCount: unmappedWindows.length,
            urgentEvents: urgentList,
            upcomingEvents: upcomingList,
            timezone: orgCtx.timezone,
            reviewUrl,
          });

          await sendOrgEmail({
            orgId,
            to: emailCfg.recipients,
            stream: 'digest',
            ...tmpl,
          });
        }
      } catch (err) {
        console.error(`scheduledEventReviewDigest failed for org ${orgId}:`, err);
      }
    }
  }
);
