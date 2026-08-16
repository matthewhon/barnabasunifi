import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface RemoveUserRequest {
  orgId: string;
  targetUid: string;
}

interface RemoveUserResponse {
  success: true;
}

/**
 * Callable Cloud Function: removeUser
 *
 * Removes a user from an organization.
 */
export const removeUser = onCall<RemoveUserRequest, Promise<RemoveUserResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to remove users.');
    }

    const { orgId, targetUid } = request.data;
    const callerClaims = request.auth.token;

    if (!orgId || typeof orgId !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId is required.');
    }
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    const isSuperAdmin = callerClaims.role === 'super_admin';
    const isOrgAdmin = callerClaims.orgId === orgId && callerClaims.role === 'org_admin';

    if (!isSuperAdmin && !isOrgAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only org admins can remove users from this organization.'
      );
    }

    const db = getFirestore();
    const auth = getAuth();

    const userRef = db.collection('users').doc(targetUid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'Target user profile not found.');
    }

    const userData = userSnap.data();
    const memberships = userData?.org_memberships ?? {};

    if (Array.isArray(memberships)) {
      const filtered = memberships.filter((m: { org_id?: string }) => m.org_id !== orgId);
      await userRef.update({ org_memberships: filtered });
    } else if (typeof memberships === 'object') {
      await userRef.update({
        [`org_memberships.${orgId}`]: FieldValue.delete(),
      });
    }

    // Reset target user's custom claims if active org was removed
    try {
      const targetUser = await auth.getUser(targetUid);
      const currentCustomClaims = targetUser.customClaims ?? {};
      if (currentCustomClaims.orgId === orgId) {
        await auth.setCustomUserClaims(targetUid, {
          ...currentCustomClaims,
          orgId: null,
          role: null,
        });
      }
    } catch (err) {
      console.error(`Failed to reset custom claims for removed user ${targetUid}:`, err);
    }

    return { success: true };
  }
);
