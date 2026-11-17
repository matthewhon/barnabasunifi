import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import { getOrgAdminEmails, getOrgEmailContext, sendOrgEmail } from './postmark';
import {
  buildDailyScheduleSummaryEmail,
  buildWeeklySecurityDigestEmail,
} from './templates/advancedAlertEmails';

function toIso(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return new Date((val as { toMillis: () => number }).toMillis()).toISOString();
  }
  return String(val);
}

/**
 * Scheduled Cloud Function: scheduledDailyDoorSchedule
 * Runs daily at 12:00 UTC (6:00 AM CT / 7:00 AM ET) and sends today's mapped
 * door unlock schedule to orgs with `email_settings.notify_daily_schedule_summary` enabled.
 */
export const scheduledDailyDoorSchedule = onSchedule(
  {
    schedule: '0 12 * * *',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const orgsSnap = await db.collection('organizations').get();
    if (orgsSnap.empty) return;

    const nowMs = Date.now();
    const endWindowMs = nowMs + 24 * 60 * 60 * 1000;

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      try {
        const orgCtx = await getOrgEmailContext(orgId);
        if (!orgCtx.emailSettings.notify_daily_schedule_summary) continue;

        let recipients = orgCtx.emailSettings.schedule_summary_recipients || orgCtx.emailSettings.alert_recipients || [];
        if (recipients.length === 0) recipients = await getOrgAdminEmails(orgId);
        if (recipients.length === 0) continue;

        const windowsSnap = await orgDoc.ref
          .collection('schedule_windows')
          .where('starts_at', '>=', Timestamp.fromMillis(nowMs - 2 * 60 * 60 * 1000))
          .get();

        const todayStr = formatInTimeZone(new Date(nowMs), orgCtx.timezone, 'yyyy-MM-dd');
        const dateLabel = formatInTimeZone(new Date(nowMs), orgCtx.timezone, 'EEEE, MMM d, yyyy');

        const mappedToday = windowsSnap.docs
          .map((d) => d.data())
          .filter((w) => {
            if (w.status === 'cancelled') return false;
            if (!Array.isArray(w.door_ids) || w.door_ids.length === 0) return false;
            const startIso = toIso(w.starts_at);
            const startMs = new Date(startIso).getTime();
            if (Number.isNaN(startMs) || startMs > endWindowMs) return false;
            return formatInTimeZone(new Date(startMs), orgCtx.timezone, 'yyyy-MM-dd') === todayStr;
          })
          .sort((a, b) => new Date(toIso(a.unlock_at)).getTime() - new Date(toIso(b.unlock_at)).getTime())
          .map((w) => ({
            title: String(w.source_label || 'PCO Event'),
            unlockAt: toIso(w.unlock_at || w.starts_at),
            lockAt: toIso(w.lock_at || w.ends_at),
            doorLabels: Array.isArray(w.door_labels) ? (w.door_labels as string[]) : [],
          }));

        if (mappedToday.length === 0) continue;

        const tmpl = buildDailyScheduleSummaryEmail({
          orgName: orgCtx.orgName,
          timezone: orgCtx.timezone,
          dateLabel,
          windows: mappedToday,
          portalUrl: orgCtx.portalUrl || undefined,
        });

        await sendOrgEmail({ orgId, to: recipients, stream: 'digest', ...tmpl });
      } catch (err) {
        console.error(`scheduledDailyDoorSchedule failed for org ${orgId}:`, err);
      }
    }
  }
);

/**
 * Scheduled Cloud Function: scheduledWeeklySecurityDigest
 * Runs every Monday at 13:00 UTC (7:00 AM CT / 8:00 AM ET) and sends a 7-day
 * security & facility digest to orgs with `email_settings.notify_weekly_security_digest` enabled.
 */
export const scheduledWeeklySecurityDigest = onSchedule(
  {
    schedule: '0 13 * * 1',
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const db = getFirestore();
    const orgsSnap = await db.collection('organizations').get();
    if (orgsSnap.empty) return;

    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAgoIso = new Date(sevenDaysAgoMs).toISOString();

    for (const orgDoc of orgsSnap.docs) {
      const orgId = orgDoc.id;
      try {
        const orgCtx = await getOrgEmailContext(orgId);
        if (!orgCtx.emailSettings.notify_weekly_security_digest) continue;

        let recipients = orgCtx.emailSettings.alert_recipients || [];
        if (recipients.length === 0) recipients = await getOrgAdminEmails(orgId);
        if (recipients.length === 0) continue;

        const [windowsSnap, commandsSnap, visitorsSnap, accessLogsSnap] = await Promise.all([
          orgDoc.ref.collection('schedule_windows').where('starts_at', '>=', Timestamp.fromMillis(sevenDaysAgoMs)).get(),
          orgDoc.ref.collection('door_commands').where('created_at', '>=', sevenDaysAgoIso).get(),
          orgDoc.ref.collection('visitors').where('start_time', '>=', sevenDaysAgoIso).get(),
          orgDoc.ref.collection('access_logs').orderBy('timestamp', 'desc').limit(500).get(),
        ]);

        const scheduledEvents = windowsSnap.docs.filter((d) => {
          const data = d.data();
          const ms = new Date(toIso(data.starts_at)).getTime();
          return ms <= nowMs && Array.isArray(data.door_ids) && data.door_ids.length > 0 && data.status !== 'cancelled';
        }).length;

        let manualOverrides = 0;
        let failedCommands = 0;
        for (const c of commandsSnap.docs) {
          const data = c.data();
          if (data.triggered_by === 'manual' && (data.action === 'unlock' || data.action === 'lock')) {
            manualOverrides++;
          }
          if (data.status === 'failed') failedCommands++;
        }

        let deniedAccessAttempts = 0;
        for (const l of accessLogsSnap.docs) {
          const data = l.data();
          const ts = new Date(toIso(data.timestamp || data.created_at)).getTime();
          if (!Number.isNaN(ts) && ts < sevenDaysAgoMs) continue;
          const resultStr = String(data.result || data.access_result || data.status || '').toLowerCase();
          if (resultStr.includes('denied') || resultStr.includes('fail') || resultStr.includes('unauthorized')) {
            deniedAccessAttempts++;
          }
        }

        const periodLabel = `${formatInTimeZone(new Date(sevenDaysAgoMs), orgCtx.timezone, 'MMM d')} – ${formatInTimeZone(new Date(nowMs), orgCtx.timezone, 'MMM d, yyyy')}`;

        const tmpl = buildWeeklySecurityDigestEmail({
          orgName: orgCtx.orgName,
          periodLabel,
          stats: {
            scheduledEvents,
            manualOverrides,
            failedCommands,
            visitorsIssued: visitorsSnap.size,
            deniedAccessAttempts,
          },
          portalUrl: orgCtx.portalUrl || undefined,
        });

        await sendOrgEmail({ orgId, to: recipients, stream: 'digest', ...tmpl });
      } catch (err) {
        console.error(`scheduledWeeklySecurityDigest failed for org ${orgId}:`, err);
      }
    }
  }
);
