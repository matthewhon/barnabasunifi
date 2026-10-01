import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

type Role = 'super_admin' | 'org_admin' | 'manager' | 'viewer';

interface GetOrgUsersRequest {
  orgId: string;
}

interface OrgUserItem {
  uid: string;
  display_name: string;
  email: string;
  role: Role;
  last_login_at?: string | null;
}

interface GetOrgUsersResponse {
  users: OrgUserItem[];
  success: true;
}

function parseDateIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (val as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof val === 'number') {
    const d = new Date(val < 100000000000 ? val * 1000 : val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
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
          last_login_at: parseDateIso(data.last_login_at),
        });
      }
    });

    // Populate missing last_login_at from Firebase Auth metadata
    const missingUids = usersList.filter((u) => !u.last_login_at).map((u) => u.uid);
    if (missingUids.length > 0) {
      try {
        const auth = getAuth();
        const authMap = new Map<string, string | null>();
        for (let i = 0; i < missingUids.length; i += 100) {
          const batch = missingUids.slice(i, i + 100).map((uid) => ({ uid }));
          const res = await auth.getUsers(batch);
          res.users.forEach((rec) => {
            if (rec.metadata.lastSignInTime) {
              const d = new Date(rec.metadata.lastSignInTime);
              if (!isNaN(d.getTime())) {
                authMap.set(rec.uid, d.toISOString());
              }
            }
          });
        }

        usersList.forEach((u) => {
          if (!u.last_login_at && authMap.has(u.uid)) {
            u.last_login_at = authMap.get(u.uid) ?? null;
          }
        });
      } catch (err) {
        console.warn('Failed to populate last_login_at from auth metadata:', err);
      }
    }

    return { users: usersList, success: true };
  }
);
