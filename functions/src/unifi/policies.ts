import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { UnifiAccessPolicy } from '../types';

// ---------------------------------------------------------------------------
// Helpers & Normalizers
// ---------------------------------------------------------------------------

export function normalizeUnifiAccessPolicy(raw: any, orgId = ''): UnifiAccessPolicy {
  const id = String(raw.id || raw.unique_id || raw.policy_id || raw._id || '');
  const name = String(raw.name || raw.policy_name || 'Access Policy');

  const doorIds: string[] = [];
  const doorLabels: string[] = [];
  const rawDoors = raw.doors || raw.door_ids || raw.resources || raw.locations;
  if (Array.isArray(rawDoors)) {
    for (const d of rawDoors) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        const dId = d.id || d.unique_id || d.door_id || d.location_id;
        const dLabel = d.name || d.label || d.location_name;
        if (dId) doorIds.push(String(dId));
        if (dLabel) doorLabels.push(String(dLabel));
      }
    }
  }

  const scheduleId = raw.schedule_id || raw.scheduleId || raw.schedule?.id || raw.work_time_id || undefined;
  const scheduleName = raw.schedule_name || raw.schedule?.name || undefined;

  return {
    id,
    org_id: orgId,
    unifi_policy_id: id,
    name,
    door_ids: doorIds,
    door_labels: doorLabels.length > 0 ? doorLabels : undefined,
    schedule_id: scheduleId,
    schedule_name: scheduleName,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    holiday_group_id: raw.holiday_group_id ? String(raw.holiday_group_id) : undefined,
    user_count: typeof raw.user_count === 'number' ? raw.user_count : undefined,
    raw_data: raw,
    last_synced: new Date().toISOString(),
    sync_status: 'synced',
  };
}

async function verifyOrgPermission(
  auth: { uid: string; token: Record<string, any> } | undefined,
  orgId: string,
  allowedRoles: string[]
): Promise<void> {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const tokenRole = auth.token?.role;
  const tokenOrgId = auth.token?.orgId;

  if (tokenRole === 'super_admin') return;

  const db = getFirestore();
  const userDoc = await db.doc(`users/${auth.uid}`).get();
  const userData = userDoc.data();
  const membership = userData?.org_memberships?.[orgId];
  const role = membership?.role || (tokenOrgId === orgId ? tokenRole : null);

  if (!role || !allowedRoles.includes(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to perform this action.');
  }
}

// ---------------------------------------------------------------------------
// Callable Functions
// ---------------------------------------------------------------------------

interface SyncPoliciesRequest {
  orgId?: string;
}

export const syncUnifiAccessPolicies = onCall<SyncPoliciesRequest, Promise<{ success: true; message: string }>>(
  async (request) => {
    const { orgId } = request.data ?? {};
    const tokenOrgId = (request.auth?.token as any)?.orgId;
    const targetOrgId = orgId || tokenOrgId;

    if (!targetOrgId) {
      throw new HttpsError('invalid-argument', 'Organization ID is required.');
    }

    await verifyOrgPermission(request.auth, targetOrgId, ['org_admin', 'manager', 'viewer']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(targetOrgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        throw new HttpsError('failed-precondition', 'Remote UniFi configuration is missing host or access token.');
      }

      const host = remoteConfig.host.replace(/\/$/, '');
      const agent = new https.Agent({ rejectUnauthorized: false });
      const client = axios.create({
        baseURL: host,
        httpsAgent: agent,
        headers: {
          'X-API-KEY': remoteConfig.access_token,
          Authorization: `Bearer ${remoteConfig.access_token}`,
        },
        timeout: 15000,
      });

      const policyMap = new Map<string, any>();
      const endpoints = [
        '/proxy/access/integration/v1/developer/access_policies',
        '/proxy/access/api/v1/developer/access_policies',
        '/api/v1/developer/access_policies',
        '/proxy/access/api/v2/policies',
        '/proxy/access/api/v2/access_policies',
        '/proxy/access/api/v2/permission/access_policies',
        '/proxy/access/api/v2/permission/policies',
        '/proxy/access/api/v2/user_groups',
        '/proxy/access/api/v2/groups',
      ];

      for (const ep of endpoints) {
        try {
          const res = await client.get<any>(ep);
          const list = Array.isArray(res.data?.data)
            ? res.data.data
            : Array.isArray(res.data?.data?.access_policies)
            ? res.data.data.access_policies
            : Array.isArray(res.data?.data?.policies)
            ? res.data.data.policies
            : Array.isArray(res.data?.data?.list)
            ? res.data.data.list
            : Array.isArray(res.data?.list)
            ? res.data.list
            : Array.isArray(res.data?.access_policies)
            ? res.data.access_policies
            : Array.isArray(res.data?.policies)
            ? res.data.policies
            : Array.isArray(res.data)
            ? res.data
            : null;

          if (list && list.length > 0) {
            for (const raw of list) {
              const pol = normalizeUnifiAccessPolicy(raw, targetOrgId);
              if (pol.id) {
                policyMap.set(pol.id, pol);
              }
            }
          }
        } catch {}
      }

      const batch = db.batch();
      for (const policy of policyMap.values()) {
        if (policy.id) {
          const docRef = db.doc(`organizations/${targetOrgId}/access_policies/${policy.id}`);
          batch.set(docRef, { ...policy, updated_at: FieldValue.serverTimestamp() }, { merge: true });
        }
      }
      await batch.commit();

      return {
        success: true,
        message: `Synchronized ${policyMap.size} access policies directly via remote API.`,
      };
    }

    // Agent mode
    const nowIso = new Date().toISOString();
    const commandRef = await db.collection(`organizations/${targetOrgId}/door_commands`).add({
      action: 'sync_policies',
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: targetOrgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
      message: 'Access policy synchronization command queued for local agent.',
    };
  }
);

/**
 * saveUnifiAccessPolicy
 * Creates or updates an Access Policy in UniFi Access.
 */
export const saveUnifiAccessPolicy = onCall<{ orgId: string; policy: Partial<UnifiAccessPolicy> }>(
  async (request) => {
    const { orgId, policy } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
    if (!policy || !policy.name?.trim()) {
      throw new HttpsError('invalid-argument', 'Policy name is required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        throw new HttpsError('failed-precondition', 'Remote UniFi configuration missing host or access token.');
      }

      const host = remoteConfig.host.replace(/\/$/, '');
      const agent = new https.Agent({ rejectUnauthorized: false });
      const client = axios.create({
        baseURL: host,
        httpsAgent: agent,
        headers: {
          'X-API-KEY': remoteConfig.access_token,
          Authorization: `Bearer ${remoteConfig.access_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const doorIds = policy.door_ids || [];
      const payload = {
        name: policy.name.trim(),
        resources: doorIds.map((id) => ({ type: 'door', id })),
        door_ids: doorIds,
        doors: doorIds,
        schedule_id: policy.schedule_id,
        holiday_group_id: policy.holiday_group_id,
        description: policy.description,
      };

      let savedRaw: any;
      if (policy.id) {
        // Update
        try {
          const res = await client.put(`/proxy/access/integration/v1/developer/access_policies/${encodeURIComponent(policy.id)}`, payload);
          savedRaw = res.data?.data ?? { id: policy.id, ...payload };
        } catch {
          const res = await client.put(`/proxy/access/api/v2/policies/${encodeURIComponent(policy.id)}`, payload);
          savedRaw = res.data?.data ?? { id: policy.id, ...payload };
        }
      } else {
        // Create
        try {
          const res = await client.post('/proxy/access/integration/v1/developer/access_policies', payload);
          savedRaw = res.data?.data ?? payload;
        } catch {
          const res = await client.post('/proxy/access/api/v2/policies', payload);
          savedRaw = res.data?.data ?? payload;
        }
      }

      const normalized = normalizeUnifiAccessPolicy(savedRaw, orgId);
      const policyId = normalized.id || policy.id;

      if (!policyId) {
        throw new HttpsError('internal', 'UniFi policy saved but no ID was returned.');
      }

      const now = FieldValue.serverTimestamp();
      await db.doc(`organizations/${orgId}/access_policies/${policyId}`).set(
        {
          ...normalized,
          id: policyId,
          org_id: orgId,
          last_synced: new Date().toISOString(),
          sync_status: 'synced',
          sync_error: null,
          updated_at: now,
        },
        { merge: true }
      );

      return {
        success: true,
        mode: 'remote',
        policy: normalized,
      };
    }

    // Agent mode: Store optimistic / pending state in Firestore and queue command
    const targetPolicyId = policy.id || db.collection(`organizations/${orgId}/access_policies`).doc().id;
    const nowIso = new Date().toISOString();

    const pendingPolicy: UnifiAccessPolicy = {
      id: targetPolicyId,
      org_id: orgId,
      unifi_policy_id: policy.unifi_policy_id || targetPolicyId,
      name: policy.name.trim(),
      door_ids: policy.door_ids || [],
      door_labels: policy.door_labels || [],
      schedule_id: policy.schedule_id,
      schedule_name: policy.schedule_name,
      description: policy.description,
      holiday_group_id: policy.holiday_group_id,
      sync_status: 'pending',
      sync_error: null,
      last_synced: nowIso,
      updated_at: nowIso,
      created_at: policy.created_at || nowIso,
      raw_data: policy.raw_data || {},
    };

    await db.doc(`organizations/${orgId}/access_policies/${targetPolicyId}`).set(pendingPolicy, { merge: true });

    const action = policy.id ? 'update_policy' : 'create_policy';
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action,
      policy_id: targetPolicyId,
      unifi_policy_id: policy.unifi_policy_id || targetPolicyId,
      policy_data: {
        ...pendingPolicy,
      },
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
      policy: pendingPolicy,
    };
  }
);

/**
 * deleteUnifiAccessPolicy
 * Deletes an Access Policy from UniFi Access and Firestore.
 */
export const deleteUnifiAccessPolicy = onCall<{ orgId: string; policyId: string; unifiPolicyId?: string }>(
  async (request) => {
    const { orgId, policyId, unifiPolicyId } = request.data ?? {};
    if (!orgId || !policyId) {
      throw new HttpsError('invalid-argument', 'orgId and policyId are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      const targetUniFiId = unifiPolicyId || policyId;

      if (remoteConfig?.host && remoteConfig?.access_token) {
        const host = remoteConfig.host.replace(/\/$/, '');
        const agent = new https.Agent({ rejectUnauthorized: false });
        const client = axios.create({
          baseURL: host,
          httpsAgent: agent,
          headers: {
            'X-API-KEY': remoteConfig.access_token,
            Authorization: `Bearer ${remoteConfig.access_token}`,
          },
          timeout: 15000,
        });

        try {
          await client.delete(`/proxy/access/integration/v1/developer/access_policies/${encodeURIComponent(targetUniFiId)}`);
        } catch {
          try {
            await client.delete(`/proxy/access/api/v2/policies/${encodeURIComponent(targetUniFiId)}`);
          } catch (err) {
            console.warn(`Could not delete access policy ${targetUniFiId} on remote host:`, err);
          }
        }
      }

      await db.doc(`organizations/${orgId}/access_policies/${policyId}`).delete();

      await db.collection(`organizations/${orgId}/audit_log`).add({
        action: 'policy_deleted',
        triggered_by: 'manual',
        actor_uid: request.auth?.uid ?? null,
        message: `Access Policy ${policyId} deleted.`,
        result: 'success',
        timestamp: FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        mode: 'remote',
      };
    }

    // Agent mode: Mark as pending and queue delete_policy command
    const targetUniFiId = unifiPolicyId || policyId;
    await db.doc(`organizations/${orgId}/access_policies/${policyId}`).set(
      {
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );

    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'delete_policy',
      policy_id: policyId,
      unifi_policy_id: targetUniFiId,
      status: 'queued',
      execute_at: new Date().toISOString(),
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: new Date().toISOString(),
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);
