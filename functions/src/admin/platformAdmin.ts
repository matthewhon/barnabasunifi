import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface TenantOverviewItem {
  id: string;
  name: string;
  slug: string;
  created_at: string | null;
  pco_connected: boolean;
  member_count: number;
}

interface UserOverviewItem {
  uid: string;
  display_name: string;
  email: string;
  creation_time: string | null;
  last_sign_in_time: string | null;
  memberships: Record<string, { role: string; joined_at?: string }>;
  is_super_admin: boolean;
}

interface GetPlatformOverviewResponse {
  tenants: TenantOverviewItem[];
  users: UserOverviewItem[];
  success: true;
}

/**
 * Helper: Recursive subcollection deletion for Firestore documents
 */
async function deleteCollection(db: FirebaseFirestore.Firestore, collectionPath: string, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(
  db: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
  resolve: (value?: unknown) => void
) {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve);
  });
}

/**
 * Callable Cloud Function: getPlatformOverview
 *
 * Super Admin only. Retrieves all users (with last login time) and all tenants.
 */
export const getPlatformOverview = onCall<unknown, Promise<GetPlatformOverviewResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (request.auth.token.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const db = getFirestore();
    const auth = getAuth();

    // 1. Fetch all Firebase Auth users
    const authUsersResult = await auth.listUsers(1000);
    const authUserMap = new Map(authUsersResult.users.map((u) => [u.uid, u]));

    // 2. Fetch all Firestore user profile documents
    const usersSnap = await db.collection('users').get();
    const userDocsMap = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));

    // Combine Auth + Firestore user data
    const userList: UserOverviewItem[] = [];
    const allUids = new Set([...authUserMap.keys(), ...userDocsMap.keys()]);

    for (const uid of allUids) {
      const authUser = authUserMap.get(uid);
      const userDoc = userDocsMap.get(uid);

      const membershipsRaw = userDoc?.org_memberships ?? {};
      const memberships: Record<string, { role: string; joined_at?: string }> = {};

      if (Array.isArray(membershipsRaw)) {
        membershipsRaw.forEach((m: { org_id?: string; role?: string }) => {
          if (m.org_id) {
            memberships[m.org_id] = { role: m.role ?? 'viewer' };
          }
        });
      } else if (typeof membershipsRaw === 'object') {
        Object.keys(membershipsRaw).forEach((orgId) => {
          memberships[orgId] = { role: membershipsRaw[orgId]?.role ?? 'viewer' };
        });
      }

      userList.push({
        uid,
        display_name: userDoc?.display_name ?? authUser?.displayName ?? authUser?.email ?? 'Unknown User',
        email: authUser?.email ?? userDoc?.email ?? '',
        creation_time: authUser?.metadata.creationTime ?? null,
        last_sign_in_time: authUser?.metadata.lastSignInTime ?? null,
        memberships,
        is_super_admin: authUser?.customClaims?.role === 'super_admin' || userDoc?.role === 'super_admin',
      });
    }

    // 3. Fetch all Organizations
    const orgsSnap = await db.collection('organizations').get();
    const tenantList: TenantOverviewItem[] = [];

    for (const orgDoc of orgsSnap.docs) {
      const orgData = orgDoc.data();
      const orgId = orgDoc.id;

      // Count member users for this org
      const memberCount = userList.filter((u) => !!u.memberships[orgId]).length;

      let createdAtStr: string | null = null;
      if (orgData.created_at) {
        if (typeof orgData.created_at.toDate === 'function') {
          createdAtStr = orgData.created_at.toDate().toISOString();
        } else if (typeof orgData.created_at === 'string') {
          createdAtStr = orgData.created_at;
        }
      }

      tenantList.push({
        id: orgId,
        name: orgData.name ?? 'Unnamed Tenant',
        slug: orgData.slug ?? orgId,
        created_at: createdAtStr,
        pco_connected: !!orgData.pco_connected,
        member_count: memberCount,
      });
    }

    return {
      tenants: tenantList,
      users: userList,
      success: true,
    };
  }
);

/**
 * Callable Cloud Function: adminDeleteUser
 *
 * Super Admin only. Completely deletes a user from Firebase Auth and Firestore.
 */
export const adminDeleteUser = onCall<{ targetUid: string }, Promise<{ success: true }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (request.auth.token.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const { targetUid } = request.data;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    if (targetUid === request.auth.uid) {
      throw new HttpsError('invalid-argument', 'You cannot delete your own active super admin account.');
    }

    const db = getFirestore();
    const auth = getAuth();

    // Delete Firestore profile doc
    await db.collection('users').doc(targetUid).delete();

    // Delete Firebase Auth user account
    try {
      await auth.deleteUser(targetUid);
    } catch (err) {
      console.warn(`Auth user ${targetUid} deletion notice:`, err);
    }

    return { success: true };
  }
);

/**
 * Callable Cloud Function: adminDeleteTenant
 *
 * Super Admin only. Deletes an organization, its settings/doors/mappings/logs subcollections,
 * and removes references from user profiles.
 */
export const adminDeleteTenant = onCall<{ targetOrgId: string }, Promise<{ success: true }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (request.auth.token.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const { targetOrgId } = request.data;
    if (!targetOrgId || typeof targetOrgId !== 'string') {
      throw new HttpsError('invalid-argument', 'targetOrgId is required.');
    }

    const db = getFirestore();
    const orgRef = db.collection('organizations').doc(targetOrgId);

    // Delete subcollections
    const subcollections = ['settings', 'doors', 'mappings', 'schedule_windows', 'door_commands', 'audit_log'];
    for (const sub of subcollections) {
      await deleteCollection(db, `organizations/${targetOrgId}/${sub}`);
    }

    // Delete organization root doc
    await orgRef.delete();

    // Scrub tenant memberships from all users in Firestore
    const usersSnap = await db.collection('users').get();
    const batch = db.batch();
    let batchCount = 0;

    usersSnap.forEach((userDoc) => {
      const data = userDoc.data();
      const memberships = data.org_memberships;

      if (!memberships) return;

      if (Array.isArray(memberships)) {
        const filtered = memberships.filter((m: { org_id?: string }) => m.org_id !== targetOrgId);
        batch.update(userDoc.ref, { org_memberships: filtered });
        batchCount++;
      } else if (typeof memberships === 'object' && memberships[targetOrgId]) {
        batch.update(userDoc.ref, {
          [`org_memberships.${targetOrgId}`]: FieldValue.delete(),
        });
        batchCount++;
      }
    });

    if (batchCount > 0) {
      await batch.commit();
    }

    return { success: true };
  }
);
