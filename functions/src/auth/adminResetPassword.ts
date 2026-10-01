import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface AdminResetPasswordRequest {
  orgId: string;
  targetUid: string;
  newPassword?: string;
  action?: 'send_email' | 'set_password';
}

interface AdminResetPasswordResponse {
  success: boolean;
  message: string;
  resetLink?: string;
}

/**
 * Callable Cloud Function: adminResetPassword
 *
 * Allows an org_admin or super_admin to reset a user's password
 * either by updating the password directly or generating a reset link.
 */
export const adminResetPassword = onCall<AdminResetPasswordRequest, Promise<AdminResetPasswordResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to reset passwords.');
    }

    const { orgId, targetUid, newPassword, action = 'send_email' } = request.data;
    const callerClaims = request.auth.token;

    if (!orgId || typeof orgId !== 'string' || !targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId and targetUid are required.');
    }

    const isSuperAdmin = callerClaims.role === 'super_admin';
    const isOrgAdmin = callerClaims.orgId === orgId && callerClaims.role === 'org_admin';

    if (!isSuperAdmin && !isOrgAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only org admins or super admins can reset user passwords.'
      );
    }

    const db = getFirestore();
    const targetUserDoc = await db.collection('users').doc(targetUid).get();

    if (!targetUserDoc.exists) {
      throw new HttpsError('not-found', 'Target user does not exist.');
    }

    const data = targetUserDoc.data();
    const memberships = data?.org_memberships;
    let belongsToOrg = false;

    if (!isSuperAdmin) {
      if (Array.isArray(memberships)) {
        belongsToOrg = memberships.some((m: { org_id?: string }) => m.org_id === orgId);
      } else if (memberships && typeof memberships === 'object') {
        belongsToOrg = Boolean(memberships[orgId]);
      }

      if (!belongsToOrg) {
        throw new HttpsError('permission-denied', 'User is not part of this organization.');
      }
    }

    const auth = getAuth();
    const targetAuthUser = await auth.getUser(targetUid);

    if (action === 'set_password' || newPassword) {
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        throw new HttpsError('invalid-argument', 'Password must be at least 6 characters long.');
      }

      await auth.updateUser(targetUid, { password: newPassword });
      return {
        success: true,
        message: `Password updated successfully for ${targetAuthUser.email || targetUid}.`,
      };
    } else {
      if (!targetAuthUser.email) {
        throw new HttpsError('invalid-argument', 'Target user does not have a registered email address.');
      }

      const resetLink = await auth.generatePasswordResetLink(targetAuthUser.email);
      return {
        success: true,
        message: `Password reset link generated for ${targetAuthUser.email}.`,
        resetLink,
      };
    }
  }
);
