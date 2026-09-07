import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { PcoClient } from './client';
import { AccessPolicyMapping, OrgSettings, PcoList } from '../types';

export interface UserSyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  usersCreated: number;
  usersUpdated: number;
  policiesRevoked: number;
  totalProcessed: number;
}

interface TriggerUserSyncRequest {
  orgId?: string;
  force?: boolean;
}

interface GetPcoListsRequest {
  orgId?: string;
}

/**
 * Reconciles Planning Center Online list memberships with UniFi Access Users & Access Policies.
 * Supports the additive policy model: user's assigned policies are the union of all active list mappings.
 * When a user is removed from a list, the policy is revoked (or all policies revoked if removed from all lists).
 */
export async function syncOrgUsers(orgId: string, force = false): Promise<UserSyncResult> {
  const db = getFirestore();
  const orgRef = db.collection('organizations').doc(orgId);

  // 1. Load org settings
  const configSnap = await orgRef.collection('settings').doc('config').get();
  if (!configSnap.exists) {
    throw new Error(`No settings config found for org ${orgId}`);
  }

  const settings = configSnap.data() as OrgSettings;

  // Check feature flag
  if (!settings.enable_user_sync && !force) {
    return {
      success: true,
      skipped: true,
      reason: 'User sync feature is disabled for this organization.',
      usersCreated: 0,
      usersUpdated: 0,
      policiesRevoked: 0,
      totalProcessed: 0,
    };
  }

  // 2. Load active access policy mappings
  const mappingsSnap = await orgRef
    .collection('access_policy_mappings')
    .where('enabled', '==', true)
    .get();

  if (mappingsSnap.empty) {
    return {
      success: true,
      skipped: true,
      reason: 'No active access policy mappings configured.',
      usersCreated: 0,
      usersUpdated: 0,
      policiesRevoked: 0,
      totalProcessed: 0,
    };
  }

  const mappings: AccessPolicyMapping[] = mappingsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AccessPolicyMapping, 'id'>),
  }));

  // 3. Initialize PCO Client
  const client = new PcoClient(orgId);
  await client.init();

  // 4. Query all active list members from PCO
  interface AggregatedPerson {
    pco_person_id: string;
    first_name: string;
    last_name: string;
    full_name: string;
    email?: string;
    phone_number?: string;
    avatar?: string;
    active_list_ids: Set<string>;
    active_list_names: Set<string>;
    assigned_policy_ids: Set<string>;
    assigned_policy_names: Set<string>;
  }

  const peopleMap = new Map<string, AggregatedPerson>();

  for (const mapping of mappings) {
    if (!mapping.pco_list_id || !mapping.unifi_policy_id) continue;

    try {
      const { people, included = [] } = await client.getListPeople(mapping.pco_list_id);

      // Build included email/phone lookups by person ID or relationship
      const emailMap = new Map<string, string>();
      const phoneMap = new Map<string, string>();

      for (const inc of included) {
        if (inc.type === 'Email' || inc.type === 'email') {
          const address = (inc.attributes?.address ?? '') as string;
          const isPrimary = Boolean(inc.attributes?.primary);
          const relPersonId = (inc.relationships as any)?.person?.data?.id;
          if (relPersonId && address) {
            if (isPrimary || !emailMap.has(relPersonId)) {
              emailMap.set(relPersonId, address);
            }
          }
        } else if (inc.type === 'PhoneNumber' || inc.type === 'phone_number') {
          const number = (inc.attributes?.number ?? '') as string;
          const isPrimary = Boolean(inc.attributes?.primary);
          const relPersonId = (inc.relationships as any)?.person?.data?.id;
          if (relPersonId && number) {
            if (isPrimary || !phoneMap.has(relPersonId)) {
              phoneMap.set(relPersonId, number);
            }
          }
        }
      }

      for (const p of people) {
        const pId = p.id;
        const attrs = p.attributes || {};
        const firstName = String(attrs.first_name || attrs.given_name || '').trim();
        const lastName = String(attrs.last_name || attrs.family_name || '').trim();
        const fullName = String(attrs.name || `${firstName} ${lastName}`).trim() || 'PCO User';
        const avatar = (attrs.avatar || attrs.photo_url || '') as string;
        const email = emailMap.get(pId) || (attrs.primary_email as string) || (attrs.email as string) || '';
        const phone = phoneMap.get(pId) || (attrs.primary_phone_number as string) || (attrs.phone_number as string) || '';

        if (!peopleMap.has(pId)) {
          peopleMap.set(pId, {
            pco_person_id: pId,
            first_name: firstName || fullName.split(' ')[0] || 'User',
            last_name: lastName || fullName.split(' ').slice(1).join(' ') || '',
            full_name: fullName,
            email: email || undefined,
            phone_number: phone || undefined,
            avatar: avatar || undefined,
            active_list_ids: new Set<string>(),
            active_list_names: new Set<string>(),
            assigned_policy_ids: new Set<string>(),
            assigned_policy_names: new Set<string>(),
          });
        }

        const person = peopleMap.get(pId)!;
        person.active_list_ids.add(mapping.pco_list_id);
        if (mapping.pco_list_name) person.active_list_names.add(mapping.pco_list_name);
        person.assigned_policy_ids.add(mapping.unifi_policy_id);
        if (mapping.unifi_policy_name) person.assigned_policy_names.add(mapping.unifi_policy_name);
      }
    } catch (err: any) {
      console.error(`Error loading members for PCO list ${mapping.pco_list_id} (${mapping.pco_list_name}):`, err);
    }
  }

  // 5. Load current synced_users from Firestore
  const syncedUsersRef = orgRef.collection('synced_users');
  const commandsRef = orgRef.collection('door_commands');
  const existingUsersSnap = await syncedUsersRef.get();

  const existingUsersMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  existingUsersSnap.docs.forEach((doc) => {
    const data = doc.data();
    const pcoId = data.pco_person_id || doc.id;
    existingUsersMap.set(pcoId, doc);
  });

  let usersCreated = 0;
  let usersUpdated = 0;
  let policiesRevoked = 0;
  const now = new Date();

  // Helper to check if two array of string IDs are identical
  const areSetsEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  };

  // 6. Process all people currently in at least one active mapped list
  for (const [pcoId, person] of peopleMap.entries()) {
    const targetPolicyIds = Array.from(person.assigned_policy_ids);
    const targetPolicyNames = Array.from(person.assigned_policy_names);
    const targetListIds = Array.from(person.active_list_ids);
    const targetListNames = Array.from(person.active_list_names);

    const existingDoc = existingUsersMap.get(pcoId);

    if (!existingDoc) {
      // User is new to the sync system -> Queue create_user command
      const newDocRef = syncedUsersRef.doc(pcoId);
      await newDocRef.set({
        pco_person_id: pcoId,
        first_name: person.first_name,
        last_name: person.last_name,
        full_name: person.full_name,
        email: person.email || null,
        phone_number: person.phone_number || null,
        avatar: person.avatar || null,
        active_list_ids: targetListIds,
        active_list_names: targetListNames,
        assigned_policy_ids: targetPolicyIds,
        assigned_policy_names: targetPolicyNames,
        status: targetPolicyIds.length > 0 ? 'active' : 'no_policy',
        last_synced_at: now.toISOString(),
        created_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
      });

      await commandsRef.add({
        action: 'create_user',
        user_id: pcoId,
        pco_person_id: pcoId,
        user_data: {
          first_name: person.first_name,
          last_name: person.last_name,
          full_name: person.full_name,
          email: person.email,
          phone_number: person.phone_number,
          avatar: person.avatar,
          policy_ids: targetPolicyIds,
        },
        policy_ids: targetPolicyIds,
        status: 'queued',
        execute_at: Timestamp.fromDate(now),
        triggered_by: 'scheduler',
        created_at: FieldValue.serverTimestamp(),
      });

      usersCreated++;
    } else {
      // User exists in synced_users
      const existingData = existingDoc.data();
      const currentPolicies: string[] = existingData.assigned_policy_ids || [];
      const unifiUserId = existingData.unifi_user_id;

      const policiesChanged = !areSetsEqual(currentPolicies, targetPolicyIds);
      const nameOrContactChanged =
        existingData.email !== person.email ||
        existingData.phone_number !== person.phone_number ||
        existingData.full_name !== person.full_name;

      if (policiesChanged || nameOrContactChanged || existingData.status === 'no_policy') {
        await existingDoc.ref.update({
          first_name: person.first_name,
          last_name: person.last_name,
          full_name: person.full_name,
          email: person.email || null,
          phone_number: person.phone_number || null,
          avatar: person.avatar || null,
          active_list_ids: targetListIds,
          active_list_names: targetListNames,
          assigned_policy_ids: targetPolicyIds,
          assigned_policy_names: targetPolicyNames,
          status: targetPolicyIds.length > 0 ? 'active' : 'no_policy',
          last_synced_at: now.toISOString(),
          updated_at: FieldValue.serverTimestamp(),
        });

        await commandsRef.add({
          action: 'assign_policies',
          user_id: pcoId,
          unifi_user_id: unifiUserId || null,
          pco_person_id: pcoId,
          user_data: {
            first_name: person.first_name,
            last_name: person.last_name,
            full_name: person.full_name,
            email: person.email,
            phone_number: person.phone_number,
            policy_ids: targetPolicyIds,
          },
          policy_ids: targetPolicyIds,
          status: 'queued',
          execute_at: Timestamp.fromDate(now),
          triggered_by: 'scheduler',
          created_at: FieldValue.serverTimestamp(),
        });

        usersUpdated++;
      }
    }
  }

  // 7. Check for users previously synced who are now removed from ALL active mapped lists
  for (const [pcoId, doc] of existingUsersMap.entries()) {
    if (!peopleMap.has(pcoId)) {
      const data = doc.data();
      const currentPolicies: string[] = data.assigned_policy_ids || [];

      if (currentPolicies.length > 0 || data.status === 'active') {
        // Revoke policies
        await doc.ref.update({
          active_list_ids: [],
          active_list_names: [],
          assigned_policy_ids: [],
          assigned_policy_names: [],
          status: 'no_policy',
          last_synced_at: now.toISOString(),
          updated_at: FieldValue.serverTimestamp(),
        });

        await commandsRef.add({
          action: 'assign_policies',
          user_id: pcoId,
          unifi_user_id: data.unifi_user_id || null,
          pco_person_id: pcoId,
          user_data: {
            first_name: data.first_name,
            last_name: data.last_name,
            email: data.email,
            policy_ids: [],
          },
          policy_ids: [],
          status: 'queued',
          execute_at: Timestamp.fromDate(now),
          triggered_by: 'scheduler',
          created_at: FieldValue.serverTimestamp(),
        });

        policiesRevoked++;
      }
    }
  }

  // 8. Write audit log
  await orgRef.collection('audit_logs').add({
    action: 'user_sync',
    triggered_by: force ? 'manual' : 'scheduler',
    result: 'success',
    users_created: usersCreated,
    users_updated: usersUpdated,
    policies_revoked: policiesRevoked,
    total_processed: peopleMap.size,
    timestamp: now.toISOString(),
  });

  return {
    success: true,
    usersCreated,
    usersUpdated,
    policiesRevoked,
    totalProcessed: peopleMap.size,
  };
}

/**
 * Callable Cloud Function: triggerUserSync
 */
export const triggerUserSync = onCall<TriggerUserSyncRequest, Promise<UserSyncResult>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to trigger user sync.');
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
        throw new HttpsError(
          'permission-denied',
          'You must be an org_admin or manager to trigger user sync.'
        );
      }
    }

    try {
      return await syncOrgUsers(orgId, true);
    } catch (err: any) {
      console.error(`User sync failed for org ${orgId}:`, err);
      throw new HttpsError('internal', err?.message || 'User sync failed.');
    }
  }
);

/**
 * Callable Cloud Function: getPcoLists
 * Returns all Planning Center lists for mapping selection.
 */
export const getPcoLists = onCall<GetPcoListsRequest, Promise<{ lists: PcoList[] }>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to fetch PCO lists.');
    }

    const tokenOrgId = (request.auth.token as any)?.orgId;
    const orgId = request.data?.orgId || tokenOrgId;

    if (!orgId) {
      throw new HttpsError('invalid-argument', 'Organization ID is required.');
    }

    try {
      const client = new PcoClient(orgId);
      await client.init();

      const rawLists = await client.getLists();

      const lists: PcoList[] = rawLists.map((item) => ({
        id: item.id,
        name: (item.attributes?.name ?? 'Unnamed List') as string,
        category: (item.attributes?.category ?? '') as string,
        total_people: (item.attributes?.total_people ?? item.attributes?.total_count ?? 0) as number,
        updated_at: (item.attributes?.updated_at ?? '') as string,
        attributes: item.attributes ?? {},
      }));

      return { lists };
    } catch (err: any) {
      console.error(`getPcoLists failed for org ${orgId}:`, err);
      throw new HttpsError('internal', err?.message || 'Failed to fetch PCO lists.');
    }
  }
);
