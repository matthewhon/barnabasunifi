import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getOrgEmailContext, sendOrgEmail } from './postmark';
import { buildSelectedEventsShareEmail, EventSummaryItem } from './templates/eventEmails';
import type { AuthClaims } from '../types';

interface SendEventInfoEmailRequest {
  orgId: string;
  recipients: string[];
  windowIds: string[];
  note?: string;
}

function toIsoString(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
    return new Date((val as { toMillis: () => number }).toMillis()).toISOString();
  }
  return String(val);
}

/**
 * Callable Cloud Function: sendEventInfoEmail
 * Allows org members (admin/manager) to email selected schedule windows / events
 * with door unlock times to specified recipients.
 */
export const sendEventInfoEmail = onCall<SendEventInfoEmailRequest, Promise<{ success: boolean; count: number }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const claims = request.auth.token as AuthClaims;
    const { orgId, recipients, windowIds, note } = request.data ?? {};

    if (!orgId || !Array.isArray(recipients) || recipients.length === 0 || !Array.isArray(windowIds) || windowIds.length === 0) {
      throw new HttpsError('invalid-argument', 'orgId, recipients, and windowIds are required.');
    }

    const isAllowed =
      claims.role === 'super_admin' ||
      (claims.orgId === orgId && (claims.role === 'org_admin' || claims.role === 'manager'));
    if (!isAllowed) {
      throw new HttpsError('permission-denied', 'Only org admins or managers can share event schedules by email.');
    }

    const db = getFirestore();
    const snaps = await Promise.all(
      windowIds.slice(0, 25).map((id) => db.doc(`organizations/${orgId}/schedule_windows/${id}`).get())
    );

    const events: EventSummaryItem[] = snaps
      .filter((s) => s.exists)
      .map((s) => {
        const d = s.data()!;
        return {
          title: (d.source_label as string) || 'PCO Event',
          startsAt: toIsoString(d.starts_at),
          endsAt: toIsoString(d.ends_at),
          unlockAt: toIsoString(d.unlock_at),
          lockAt: toIsoString(d.lock_at),
          sourceType: (d.source_type as string) || 'service',
          doorLabels: Array.isArray(d.door_labels) ? (d.door_labels as string[]) : [],
        };
      });

    if (events.length === 0) {
      throw new HttpsError('not-found', 'No matching events found.');
    }

    const orgCtx = await getOrgEmailContext(orgId);
    const tmpl = buildSelectedEventsShareEmail({
      orgName: orgCtx.orgName,
      senderEmail: request.auth.token.email as string | undefined,
      note,
      events,
      timezone: orgCtx.timezone,
    });

    const res = await sendOrgEmail({
      orgId,
      to: recipients,
      ...tmpl,
    });

    if (!res.sent) {
      throw new HttpsError('failed-precondition', res.error || 'Failed to send event schedule email.');
    }

    return { success: true, count: events.length };
  }
);
