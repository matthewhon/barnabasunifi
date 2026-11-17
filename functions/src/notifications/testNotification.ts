import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { sendSlackUnmappedEventAlert } from './slack';
import { sendOrgEmail } from './postmark';
import type { AuthClaims } from '../types';

interface TestSlackNotificationRequest {
  orgId?: string;
  webhookUrl: string;
}

export const sendTestSlackNotification = onCall<TestSlackNotificationRequest, Promise<{ success: boolean }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const { webhookUrl, orgId: reqOrgId } = request.data ?? {};
    const tokenOrgId = (request.auth.token as any)?.orgId;
    const targetOrgId = reqOrgId || tokenOrgId;

    if (!targetOrgId || !webhookUrl) {
      throw new HttpsError('invalid-argument', 'Organization ID and Webhook URL are required.');
    }

    const db = getFirestore();
    const orgSnap = await db.doc(`organizations/${targetOrgId}`).get();
    const orgName = (orgSnap.data()?.name as string) || targetOrgId;

    const sent = await sendSlackUnmappedEventAlert({
      webhookUrl,
      orgName,
      unmappedCount: 3,
      urgentEvents: [
        {
          title: 'Sunday Worship Service (Test)',
          startsAt: 'Tomorrow at 9:00 AM',
          sourceType: 'service',
        },
      ],
    });

    if (!sent) {
      throw new HttpsError('internal', 'Failed to deliver Slack webhook notification. Check URL format.');
    }

    return { success: true };
  }
);

interface TestEmailNotificationRequest {
  orgId?: string;
  recipientEmail: string;
}

/**
 * Callable Cloud Function: sendTestEmailNotification
 * Sends a branded test email using the organization's logo, from_name, and reply_to
 * via the platform-wide Postmark integration.
 */
export const sendTestEmailNotification = onCall<TestEmailNotificationRequest, Promise<{ success: boolean; messageId?: string }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const claims = request.auth.token as AuthClaims;
    const { recipientEmail, orgId: reqOrgId } = request.data ?? {};
    const targetOrgId = reqOrgId || claims.orgId;

    if (!targetOrgId || !recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'Organization ID and a valid recipientEmail are required.');
    }

    const isSuperAdmin = claims.role === 'super_admin';
    const isOrgAdmin = claims.orgId === targetOrgId && (claims.role === 'org_admin' || claims.role === 'manager');
    if (!isSuperAdmin && !isOrgAdmin) {
      throw new HttpsError('permission-denied', 'Only org admins or managers can send test emails.');
    }

    const res = await sendOrgEmail({
      orgId: targetOrgId,
      to: recipientEmail.trim(),
      subject: 'Test Email from UnFi-PCO',
      title: 'Postmark Email Delivery Verified',
      preheader: 'Your organization email branding and Postmark delivery are working.',
      bodyHtml: `
        <p style="margin:0 0 12px 0;">
          This is a test email confirming that <strong>Postmark</strong> email delivery is configured and working for your organization.
        </p>
        <p style="margin:0;color:#475569;font-size:13px;">
          Your tenant logo, sender display name, reply-to address, and footer settings are applied automatically to all outgoing notifications.
        </p>
      `,
      textBody: 'This is a test email confirming that Postmark email delivery is configured and working for your organization.',
      tag: 'test-email',
    });

    if (!res.sent) {
      throw new HttpsError('failed-precondition', res.error || 'Failed to send test email. Check platform Postmark settings.');
    }

    return { success: true, messageId: res.messageIds?.[0] };
  }
);

/**
 * Callable Cloud Function (super_admin only): sendTestPlatformEmail
 * Tests the platform-wide Postmark token and sender signature without an org.
 */
export const sendTestPlatformEmail = onCall<{ recipientEmail: string }, Promise<{ success: boolean; messageId?: string }>>(
  async (request) => {
    const claims = request.auth?.token as AuthClaims | undefined;
    if (!claims || claims.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only super_admins can send platform test emails.');
    }

    const recipientEmail = request.data?.recipientEmail?.trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid recipientEmail is required.');
    }

    const res = await sendOrgEmail({
      to: recipientEmail,
      subject: 'UnFi-PCO Platform Postmark Test',
      title: 'Platform Postmark Configuration Verified',
      bodyHtml: '<p style="margin:0;">Platform-wide Postmark sending is active and delivering emails.</p>',
      textBody: 'Platform-wide Postmark sending is active and delivering emails.',
      tag: 'platform-test-email',
    });

    if (!res.sent) {
      throw new HttpsError('failed-precondition', res.error || 'Failed to send platform test email.');
    }

    return { success: true, messageId: res.messageIds?.[0] };
  }
);
