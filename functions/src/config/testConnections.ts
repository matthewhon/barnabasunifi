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
 * Turns a failed UniFi request into a message that names the actual problem.
 * The raw axios text ("Request failed with status code 401") is indistinguishable
 * between a bad key, the wrong key type, and Access not being installed.
 */
function describeUnifiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      return 'the console rejected the API key (401). Confirm it is a UniFi Access '
        + 'Integration key created in the Access app — a UniFi OS or Network key will not work here.';
    }
    if (status === 404) {
      return 'the console authenticated the key but has no Access API at that path (404). '
        + 'UniFi Access may not be installed on this console, or the key lacks Access scope.';
    }
    if (err.code === 'ECONNABORTED') {
      return 'the request timed out. The console did not respond within 10s.';
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ETIMEDOUT') {
      return `the host is unreachable (${err.code}). Check the URL and that the console is reachable from the internet.`;
    }
    return status ? `the console returned HTTP ${status}.` : err.message;
  }
  return err instanceof Error ? err.message : 'Failed to connect to remote UniFi host.';
}

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
        // UniFi Access Integration API, reached through the UniFi OS reverse
        // proxy on 443. Authenticates with X-API-KEY — an Access integration
        // key, not a UniFi OS/Network key and not a bearer token.
        const res = await axios.get(`${host}/proxy/access/integration/v1/developer/doors`, {
          headers: { 'X-API-KEY': remoteConfig.access_token },
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
        return {
          success: false,
          mode: 'remote',
          door_count: doorCount,
          message: `Direct Remote HTTPS test failed: ${describeUnifiError(err)}`,
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
