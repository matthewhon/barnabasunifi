import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { refreshPcoToken } from '../pco/oauth';

interface TestConnectionRequest {
  orgId: string;
}

interface TestPcoResponse {
  success: boolean;
  message: string;
  pco_org_name?: string;
  service_types_count?: number;
}

interface TestUnifiResponse {
  success: boolean;
  message: string;
  mode: 'agent' | 'remote';
  agent_name?: string;
  is_online?: boolean;
  last_heartbeat?: string;
  door_count?: number;
}

/**
 * Helper: Check caller authorization for an organization
 */
function verifyOrgAdminPermission(auth: { uid: string; token: Record<string, unknown> } | undefined, orgId: string) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const role = auth.token.role as string | undefined;
  const tokenOrgId = auth.token.orgId as string | undefined;

  if (role === 'super_admin') return;

  if (tokenOrgId === orgId && (role === 'org_admin' || role === 'manager')) {
    return;
  }

  throw new HttpsError('permission-denied', 'You do not have permission to test connections for this organization.');
}

/**
 * Callable Cloud Function: testPcoConnection
 */
export const testPcoConnection = onCall<TestConnectionRequest, Promise<TestPcoResponse>>(
  async (request) => {
    const { orgId } = request.data;
    if (!orgId || typeof orgId !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId is required.');
    }

    verifyOrgAdminPermission(request.auth, orgId);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();

    if (!configSnap.exists) {
      throw new HttpsError('not-found', 'Organization configuration not found.');
    }

    const configData = configSnap.data();
    const oauth = configData?.pco_oauth;

    if (!oauth || !oauth.refresh_token) {
      return {
        success: false,
        message: 'Planning Center is not connected. Please click "Connect Planning Center" first.',
      };
    }

    try {
      // 1. Refresh or validate access token
      const accessToken = await refreshPcoToken(orgId);

      // 2. Query PCO API for organization and service types info
      const [orgRes, servicesRes] = await Promise.all([
        axios.get('https://api.planningcenteronline.com/services/v2', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        axios.get('https://api.planningcenteronline.com/services/v2/service_types', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      const orgName = orgRes.data?.data?.attributes?.name ?? 'Planning Center Account';
      const serviceTypesCount = servicesRes.data?.data?.length ?? 0;

      return {
        success: true,
        message: `Successfully connected to Planning Center (${orgName})! Found ${serviceTypesCount} service types.`,
        pco_org_name: orgName,
        service_types_count: serviceTypesCount,
      };
    } catch (err: unknown) {
      console.error('Error testing PCO connection:', err);
      const message = err instanceof Error ? err.message : 'Failed to communicate with Planning Center API.';
      return {
        success: false,
        message: `PCO Connection Test Failed: ${message}`,
      };
    }
  }
);

/**
 * Callable Cloud Function: testUnifiConnection
 */
export const testUnifiConnection = onCall<TestConnectionRequest, Promise<TestUnifiResponse>>(
  async (request) => {
    const { orgId } = request.data;
    if (!orgId || typeof orgId !== 'string') {
      throw new HttpsError('invalid-argument', 'orgId is required.');
    }

    verifyOrgAdminPermission(request.auth, orgId);

    const db = getFirestore();

    // 1. Count doors synced for this org
    const doorsSnap = await db.collection('organizations').doc(orgId).collection('doors').get();
    const doorCount = doorsSnap.size;

    // 2. Read org settings for connection mode
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        return {
          success: false,
          mode: 'remote',
          door_count: doorCount,
          message: 'Direct Remote HTTPS is selected, but UniFi Host URL or Access Token is missing in settings.',
        };
      }

      try {
        const host = remoteConfig.host.replace(/\/$/, '');
        const agent = new https.Agent({ rejectUnauthorized: false });
        const res = await axios.get(`${host}/api/v1/developer/doors`, {
          headers: { Authorization: `Bearer ${remoteConfig.access_token}` },
          timeout: 10000,
          httpsAgent: agent,
        });

        const remoteDoorCount = Array.isArray(res.data?.data) ? res.data.data.length : doorCount;
        return {
          success: true,
          mode: 'remote',
          door_count: remoteDoorCount,
          message: `Direct Remote HTTPS connection succeeded! (${remoteDoorCount} doors found)`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to connect to remote UniFi host.';
        return {
          success: false,
          mode: 'remote',
          door_count: doorCount,
          message: `Direct Remote HTTPS test failed: ${message}`,
        };
      }
    }

    // 3. Check registered local agents (agent mode)
    const agentsSnap = await db.collection('agents').where('org_id', '==', orgId).get();

    if (agentsSnap.empty) {
      return {
        success: false,
        mode: 'agent',
        message: 'No UniFi local agent is registered for this organization.',
        door_count: doorCount,
      };
    }

    const agentDoc = agentsSnap.docs[0].data();
    const agentName = agentDoc.label ?? agentDoc.agent_name ?? 'UniFi Local Agent';

    let lastHeartbeatStr: string | undefined;
    let isOnline = false;

    if (agentDoc.last_heartbeat) {
      const heartbeatDate = typeof agentDoc.last_heartbeat.toDate === 'function'
        ? agentDoc.last_heartbeat.toDate()
        : new Date(agentDoc.last_heartbeat);

      lastHeartbeatStr = heartbeatDate.toISOString();

      // Online if heartbeat within 5 minutes (300,000 ms)
      const diffMs = Date.now() - heartbeatDate.getTime();
      isOnline = diffMs < 5 * 60 * 1000;
    }

    if (isOnline) {
      return {
        success: true,
        mode: 'agent',
        agent_name: agentName,
        is_online: true,
        last_heartbeat: lastHeartbeatStr,
        door_count: doorCount,
        message: `Agent "${agentName}" is ONLINE. Registered doors: ${doorCount}.`,
      };
    }

    return {
      success: false,
      mode: 'agent',
      agent_name: agentName,
      is_online: false,
      last_heartbeat: lastHeartbeatStr,
      door_count: doorCount,
      message: `Agent "${agentName}" is OFFLINE (last heartbeat was ${lastHeartbeatStr ? new Date(lastHeartbeatStr).toLocaleString() : 'never'}).`,
    };
  }
);
