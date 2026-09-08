import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

export interface TenantOverviewItem {
  id: string;
  name: string;
  slug: string;
  created_at: string | null;
  pco_connected: boolean;
  unifi_mode: 'agent' | 'remote' | 'unconfigured';
  member_count: number;
  door_count: number;
  mapping_count: number;
  schedule_window_count: number;
  pco_org_name?: string;
  timezone?: string;
  agent_status?: {
    has_token: boolean;
    auto_discovered_host?: string;
    last_sync?: string;
  };
}

export interface UserOverviewItem {
  uid: string;
  display_name: string;
  email: string;
  creation_time: string | null;
  last_sign_in_time: string | null;
  memberships: Record<string, { role: string; joined_at?: string }>;
  is_super_admin: boolean;
}

export interface PlatformMetrics {
  total_tenants: number;
  total_users: number;
  total_doors: number;
  total_mappings: number;
  total_schedule_windows: number;
  pco_connected_tenants: number;
  unifi_agent_tenants: number;
  unifi_remote_tenants: number;
  active_users_30d: number;
  roles_distribution: {
    super_admin: number;
    org_admin: number;
    manager: number;
    viewer: number;
  };
  signup_timeline: Array<{
    period: string;
    tenants: number;
    users: number;
  }>;
}

export interface SystemAuditItem {
  id: string;
  org_id: string;
  action: string;
  actor_name: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface GetPlatformOverviewResponse {
  tenants: TenantOverviewItem[];
  users: UserOverviewItem[];
  metrics: PlatformMetrics;
  recent_logs: SystemAuditItem[];
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
 * Check if the request is from a designated or claims-based super admin
 */
function isUserSuperAdmin(requestAuth: { uid: string; token: Record<string, unknown> } | undefined): boolean {
  if (!requestAuth) return false;
  if (requestAuth.token.role === 'super_admin') return true;
  const email = (requestAuth.token.email as string | undefined)?.toLowerCase().trim();
  if (email === 'matthew.hon@honventures.com') return true;
  return false;
}

/**
 * Callable Cloud Function: getPlatformOverview
 *
 * Super Admin only. Retrieves all users, tenants, cross-tenant metrics, and system activity logs.
 */
export const getPlatformOverview = onCall<unknown, Promise<GetPlatformOverviewResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (!isUserSuperAdmin(request.auth)) {
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

    let superAdminCount = 0;
    let orgAdminCount = 0;
    let managerCount = 0;
    let viewerCount = 0;
    let activeUsers30d = 0;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

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

      const email = authUser?.email ?? userDoc?.email ?? '';
      const isSuper =
        authUser?.customClaims?.role === 'super_admin' ||
        userDoc?.role === 'super_admin' ||
        email.toLowerCase() === 'matthew.hon@honventures.com';

      if (isSuper) {
        superAdminCount++;
      } else {
        const roles = Object.values(memberships).map((m) => m.role);
        if (roles.includes('org_admin')) orgAdminCount++;
        else if (roles.includes('manager')) managerCount++;
        else viewerCount++;
      }

      const lastSignInTime = authUser?.metadata.lastSignInTime ?? null;
      if (lastSignInTime && new Date(lastSignInTime).getTime() > thirtyDaysAgo) {
        activeUsers30d++;
      }

      userList.push({
        uid,
        display_name: userDoc?.display_name ?? authUser?.displayName ?? authUser?.email ?? 'Unknown User',
        email,
        creation_time: authUser?.metadata.creationTime ?? null,
        last_sign_in_time: lastSignInTime,
        memberships,
        is_super_admin: isSuper,
      });
    }

    // 3. Fetch all Organizations & Subcollection Stats
    const orgsSnap = await db.collection('organizations').get();
    const tenantList: TenantOverviewItem[] = [];

    let totalGlobalDoors = 0;
    let totalGlobalMappings = 0;
    let totalGlobalScheduleWindows = 0;
    let pcoConnectedCount = 0;
    let unifiAgentCount = 0;
    let unifiRemoteCount = 0;

    const allLogs: SystemAuditItem[] = [];

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

      // Fetch org subcollection counts in parallel
      const [settingsDoc, doorsSnap, mappingsSnap, windowsSnap, agentTokensSnap, logsSnap] = await Promise.all([
        db.doc(`organizations/${orgId}/settings/config`).get().catch(() => null),
        db.collection(`organizations/${orgId}/doors`).get().catch(() => ({ size: 0, docs: [] })),
        db.collection(`organizations/${orgId}/mappings`).get().catch(() => ({ size: 0, docs: [] })),
        db.collection(`organizations/${orgId}/schedule_windows`).get().catch(() => ({ size: 0, docs: [] })),
        db.collection(`organizations/${orgId}/agent_tokens`).get().catch(() => ({ size: 0, docs: [] })),
        db.collection(`organizations/${orgId}/audit_log`).orderBy('timestamp', 'desc').limit(5).get().catch(() => ({ docs: [] })),
      ]);

      const settingsData = settingsDoc?.data();
      const pcoConnected = !!orgData.pco_connected || !!settingsData?.pco_oauth?.access_token;
      if (pcoConnected) pcoConnectedCount++;

      const unifiMode: 'agent' | 'remote' | 'unconfigured' =
        settingsData?.unifi_mode === 'remote'
          ? 'remote'
          : (settingsData?.unifi_mode === 'agent' || settingsData?.unifi_agent?.access_token)
          ? 'agent'
          : 'unconfigured';

      if (unifiMode === 'agent') unifiAgentCount++;
      if (unifiMode === 'remote') unifiRemoteCount++;

      const doorCount = doorsSnap.size;
      const mappingCount = mappingsSnap.size;
      const windowCount = windowsSnap.size;

      totalGlobalDoors += doorCount;
      totalGlobalMappings += mappingCount;
      totalGlobalScheduleWindows += windowCount;

      // Extract audit logs
      logsSnap.docs.forEach((doc) => {
        const d = doc.data();
        let tsStr = new Date().toISOString();
        if (d.timestamp) {
          if (typeof d.timestamp.toDate === 'function') tsStr = d.timestamp.toDate().toISOString();
          else if (typeof d.timestamp === 'string') tsStr = d.timestamp;
        }
        allLogs.push({
          id: doc.id,
          org_id: orgId,
          action: d.action || 'System Event',
          actor_name: d.actor_name || d.user_email || 'System',
          timestamp: tsStr,
          details: d.details || {},
        });
      });

      tenantList.push({
        id: orgId,
        name: orgData.name ?? 'Unnamed Tenant',
        slug: orgData.slug ?? orgId,
        created_at: createdAtStr,
        pco_connected: pcoConnected,
        unifi_mode: unifiMode,
        member_count: memberCount,
        door_count: doorCount,
        mapping_count: mappingCount,
        schedule_window_count: windowCount,
        pco_org_name: settingsData?.pco_oauth?.pco_org_name,
        timezone: settingsData?.timezone || 'America/Chicago',
        agent_status: {
          has_token: (agentTokensSnap.size || 0) > 0,
          auto_discovered_host: settingsData?.unifi_agent?.auto_discovered_host,
        },
      });
    }

    // Sort recent logs globally
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const recentLogs = allLogs.slice(0, 25);

    // Compute monthly signup timeline (last 6 months)
    const monthsMap: Record<string, { tenants: number; users: number }> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      monthsMap[key] = { tenants: 0, users: 0 };
    }

    tenantList.forEach((t) => {
      if (t.created_at) {
        const key = new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        if (monthsMap[key]) monthsMap[key].tenants++;
      }
    });

    userList.forEach((u) => {
      if (u.creation_time) {
        const key = new Date(u.creation_time).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        if (monthsMap[key]) monthsMap[key].users++;
      }
    });

    const signupTimeline = Object.entries(monthsMap).map(([period, data]) => ({
      period,
      tenants: data.tenants,
      users: data.users,
    }));

    const metrics: PlatformMetrics = {
      total_tenants: tenantList.length,
      total_users: userList.length,
      total_doors: totalGlobalDoors,
      total_mappings: totalGlobalMappings,
      total_schedule_windows: totalGlobalScheduleWindows,
      pco_connected_tenants: pcoConnectedCount,
      unifi_agent_tenants: unifiAgentCount,
      unifi_remote_tenants: unifiRemoteCount,
      active_users_30d: activeUsers30d,
      roles_distribution: {
        super_admin: superAdminCount,
        org_admin: orgAdminCount,
        manager: managerCount,
        viewer: viewerCount,
      },
      signup_timeline: signupTimeline,
    };

    return {
      tenants: tenantList,
      users: userList,
      metrics,
      recent_logs: recentLogs,
      success: true,
    };
  }
);

/**
 * Callable Cloud Function: adminSetUserSuperAdmin
 *
 * Super Admin only. Grants or revokes super_admin role for a target user.
 */
export const adminSetUserSuperAdmin = onCall<{ targetUid: string; isSuperAdmin: boolean }, Promise<{ success: true }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    if (!isUserSuperAdmin(request.auth)) {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const { targetUid, isSuperAdmin } = request.data;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    if (targetUid === request.auth.uid && !isSuperAdmin) {
      throw new HttpsError('invalid-argument', 'You cannot revoke your own Super Admin access.');
    }

    const db = getFirestore();
    const auth = getAuth();

    // 1. Update Firebase Auth Custom Claims
    const targetUser = await auth.getUser(targetUid);
    const currentClaims = targetUser.customClaims || {};

    if (isSuperAdmin) {
      await auth.setCustomUserClaims(targetUid, {
        ...currentClaims,
        role: 'super_admin',
      });
    } else {
      const newClaims = { ...currentClaims };
      if (newClaims.role === 'super_admin') {
        delete newClaims.role;
      }
      await auth.setCustomUserClaims(targetUid, newClaims);
    }

    // 2. Update Firestore user doc
    const userDocRef = db.collection('users').doc(targetUid);
    const userDoc = await userDocRef.get();
    if (userDoc.exists) {
      await userDocRef.update({
        role: isSuperAdmin ? 'super_admin' : FieldValue.delete(),
        is_super_admin: isSuperAdmin,
        updated_at: new Date().toISOString(),
      });
    }

    return { success: true };
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

    if (!isUserSuperAdmin(request.auth)) {
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

    if (!isUserSuperAdmin(request.auth)) {
      throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    const { targetOrgId } = request.data;
    if (!targetOrgId || typeof targetOrgId !== 'string') {
      throw new HttpsError('invalid-argument', 'targetOrgId is required.');
    }

    const db = getFirestore();
    const orgRef = db.collection('organizations').doc(targetOrgId);

    // Comprehensive list of subcollections to purge
    const subcollections = [
      'settings',
      'doors',
      'campuses',
      'mappings',
      'schedule_windows',
      'door_commands',
      'unifi_schedules',
      'visitors',
      'access_policies',
      'agent_tokens',
      'audit_log',
    ];

    for (const sub of subcollections) {
      try {
        await deleteCollection(db, `organizations/${targetOrgId}/${sub}`);
      } catch (err) {
        console.warn(`Subcollection deletion notice for ${sub}:`, err);
      }
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
