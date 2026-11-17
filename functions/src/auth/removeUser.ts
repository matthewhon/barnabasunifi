import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getOrgEmailContext, sendOrgEmail } from '../notifications/postmark';
import { buildUserRemovedEmail } from '../notifications/templates/userEmails';

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
    let targetEmail: string | undefined = userData?.email;
    try {
      const targetUser = await auth.getUser(targetUid);
      targetEmail = targetEmail || targetUser.email;
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

    if (targetEmail) {
      try {
        const orgCtx = await getOrgEmailContext(orgId);
        const tmpl = buildUserRemovedEmail({ orgName: orgCtx.orgName });
        await sendOrgEmail({ orgId, to: targetEmail, ...tmpl });
      } catch (err) {
        console.error('Failed to send user removed email:', err);
      }
    }

    return { success: true };
  }
);
