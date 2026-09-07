import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

interface SyncPoliciesRequest {
  orgId?: string;
}

export const syncUnifiAccessPolicies = onCall<SyncPoliciesRequest, Promise<{ success: true; message: string }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const tokenRole = (request.auth.token as any)?.role;
    const tokenOrgId = (request.auth.token as any)?.orgId;
    const orgId = request.data?.orgId || tokenOrgId;

    if (!orgId) {
      throw new HttpsError('invalid-argument', 'Organization ID is required.');
    }

    const isSuperAdmin = tokenRole === 'super_admin';
    if (!isSuperAdmin) {
      const userDoc = await getFirestore().doc(`users/${request.auth.uid}`).get();
      const membership = userDoc.data()?.org_memberships?.[orgId];
      const role = membership?.role || (tokenOrgId === orgId ? tokenRole : null);
      if (!role || !['org_admin', 'manager'].includes(role)) {
        throw new HttpsError('permission-denied', 'Permission denied.');
      }
    }

    const db = getFirestore();
    const commandsRef = db.collection('organizations').doc(orgId).collection('door_commands');

    await commandsRef.add({
      action: 'sync_policies',
      status: 'queued',
      execute_at: Timestamp.fromDate(new Date()),
      triggered_by: 'manual',
      actor_uid: request.auth.uid,
      created_at: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      message: 'Access policy synchronization command queued for local agent.',
    };
  }
);
