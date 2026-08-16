import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

type Role = 'org_admin' | 'manager' | 'viewer';

interface ChangeUserRoleRequest {
  orgId: string;
  targetUid: string;
  role: Role;
}

interface ChangeUserRoleResponse {
  success: true;
}

/**
 * Callable Cloud Function: changeUserRole
 *
 * Allows an org_admin or super_admin to update a user's role in the organization.
 */
export const changeUserRole = onCall<ChangeUserRoleRequest, Promise<ChangeUserRoleResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to change user roles.');
    }

    const { orgId, targetUid, role } = request.data;
    const callerClaims = request.auth.token;

    if (!orgId || typeof orgId !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId is required.');
    }
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    const validRoles: Role[] = ['org_admin', 'manager', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new HttpsError('invalid-argument', `role must be one of: ${validRoles.join(', ')}.`);
    }

    const isSuperAdmin = callerClaims.role === 'super_admin';
    const isOrgAdmin = callerClaims.orgId === orgId && callerClaims.role === 'org_admin';

    if (!isSuperAdmin && !isOrgAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only org admins can change user roles in this organization.'
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
    let memberships = userData?.org_memberships ?? {};

    // Standardize object format update
    if (Array.isArray(memberships)) {
      const updatedArray = memberships.map((m: { org_id: string; role: Role }) =>
        m.org_id === orgId ? { ...m, role } : m
      );
      await userRef.update({ org_memberships: updatedArray });
    } else {
      await userRef.update({
        [`org_memberships.${orgId}.role`]: role,
        [`org_memberships.${orgId}.updated_at`]: FieldValue.serverTimestamp(),
      });
    }

    // Update target user's custom claims if their active org matches
    try {
      const targetUser = await auth.getUser(targetUid);
      const currentCustomClaims = targetUser.customClaims ?? {};
      if (currentCustomClaims.orgId === orgId) {
        await auth.setCustomUserClaims(targetUid, {
          ...currentCustomClaims,
          role,
        });
      }
    } catch (err) {
      console.error(`Failed to update custom claims for user ${targetUid}:`, err);
    }

    return { success: true };
  }
);
