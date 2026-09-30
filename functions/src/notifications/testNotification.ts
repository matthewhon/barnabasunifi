import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { sendSlackUnmappedEventAlert } from './slack';

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
