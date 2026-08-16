import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

type Role = 'super_admin' | 'org_admin' | 'manager' | 'viewer';

interface GetOrgUsersRequest {
  orgId: string;
}

interface OrgUserItem {
  uid: string;
  display_name: string;
  email: string;
  role: Role;
}

interface GetOrgUsersResponse {
  users: OrgUserItem[];
  success: true;
}

/**
 * Callable Cloud Function: getOrgUsers
 *
 * Safely fetches user profiles belonging to the specified orgId.
 * Only callable by users with org_admin role or super_admin.
 */
export const getOrgUsers = onCall<GetOrgUsersRequest, Promise<GetOrgUsersResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to view users.');
    }

    const { orgId } = request.data;
    const callerClaims = request.auth.token;

    if (!orgId || typeof orgId !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId is required.');
    }

    const isSuperAdmin = callerClaims.role === 'super_admin';
    const isOrgAdmin = callerClaims.orgId === orgId && callerClaims.role === 'org_admin';

    if (!isSuperAdmin && !isOrgAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only org admins can view the user list for this organization.'
      );
    }

    const db = getFirestore();
    const usersSnap = await db.collection('users').get();

    const usersList: OrgUserItem[] = [];

    usersSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const memberships = data.org_memberships;

      if (!memberships) return;

      let roleForOrg: Role | null = null;

      if (Array.isArray(memberships)) {
        const found = memberships.find((m: { org_id?: string; role?: Role }) => m.org_id === orgId);
        if (found) {
          roleForOrg = found.role ?? 'viewer';
        }
      } else if (typeof memberships === 'object') {
        if (memberships[orgId]) {
          roleForOrg = memberships[orgId].role ?? 'viewer';
        }
      }

      if (roleForOrg) {
        usersList.push({
          uid: docSnap.id,
          display_name: data.display_name ?? data.email ?? 'Unknown User',
          email: data.email ?? '',
          role: roleForOrg,
        });
      }
    });

    return { users: usersList, success: true };
  }
);
