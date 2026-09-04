/**
 * agent/agentRegistration.ts
 * Manages connection tokens and handshake registration for on-premises Local Agents.
 */

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as crypto from 'crypto';

interface GenerateTokenRequest {
  orgId: string;
  label?: string;
}

interface GenerateTokenResponse {
  connectionToken: string;
  tokenId: string;
  orgId: string;
}

/**
 * Callable Cloud Function: generateAgentToken
 * Allows org admins to create a connection token for pairing an on-prem local agent.
 */
export const generateAgentToken = onCall<
  GenerateTokenRequest,
  Promise<GenerateTokenResponse>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to generate an agent token.');
  }

  const { orgId, label } = request.data || {};
  if (!orgId || typeof orgId !== 'string') {
    throw new HttpsError('invalid-argument', 'orgId is required.');
  }

  const tokenRole = (request.auth.token as any).role;
  const tokenOrgId = (request.auth.token as any).orgId;
  const isSuperAdmin = tokenRole === 'super_admin';

  const db = getFirestore();

  // Validate user membership if not super_admin
  if (!isSuperAdmin) {
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    const membership = userData?.org_memberships?.[orgId];
    const role = membership?.role || (tokenOrgId === orgId ? tokenRole : null);

    if (!role || !['org_admin', 'manager'].includes(role)) {
      throw new HttpsError('permission-denied', 'You must be an admin or manager to generate an agent token.');
    }
  }

  const tokenId = crypto.randomUUID();
  const secret = crypto.randomBytes(24).toString('hex');
  const projectId = process.env.GCLOUD_PROJECT || 'barnabasunfi';

  // Save active token in Firestore
  await db.doc(`organizations/${orgId}/agent_tokens/${tokenId}`).set({
    token_id: tokenId,
    token_secret: secret,
    org_id: orgId,
    label: label || 'Local Agent',
    created_at: FieldValue.serverTimestamp(),
    created_by: request.auth.uid,
    status: 'active',
  });

  // Package token into a base64 connection string
  const payload = {
    v: 1,
    orgId,
    tokenId,
    secret,
    projectId,
    endpoint: `https://us-central1-${projectId}.cloudfunctions.net/registerAgentWithToken`,
  };

  const connectionToken = `UPCO_${Buffer.from(JSON.stringify(payload)).toString('base64')}`;

  // Log to audit log
  await db.collection(`organizations/${orgId}/audit_log`).add({
    action: 'agent_token_generated',
    actor_id: request.auth.uid,
    actor_email: request.auth.token.email || '',
    token_id: tokenId,
    label: label || 'Local Agent',
    timestamp: FieldValue.serverTimestamp(),
  });

  return {
    connectionToken,
    tokenId,
    orgId,
  };
});

/**
 * HTTPS Cloud Function: registerAgentWithToken
 * Called by the Local Agent during setup to complete the registration handshake.
 */
export const registerAgentWithToken = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const { token, agentId, label, unifiHost, version } = req.body || {};

  if (!token || typeof token !== 'string') {
    res.status(400).json({ ok: false, error: 'Connection token is required.' });
    return;
  }

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ ok: false, error: 'agentId is required.' });
    return;
  }

  try {
    // 1. Decode token
    const base64Str = token.replace(/^UPCO_/, '').trim();
    const raw = Buffer.from(base64Str, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);

    const { orgId, tokenId, secret } = parsed || {};
    if (!orgId || !tokenId || !secret) {
      res.status(400).json({ ok: false, error: 'Invalid token format.' });
      return;
    }

    const db = getFirestore();

    // 2. Validate token against Firestore
    const tokenDoc = await db.doc(`organizations/${orgId}/agent_tokens/${tokenId}`).get();
    if (!tokenDoc.exists) {
      res.status(401).json({ ok: false, error: 'Invalid or expired connection token.' });
      return;
    }

    const tokenData = tokenDoc.data();
    if (tokenData?.status !== 'active' || tokenData?.token_secret !== secret) {
      res.status(401).json({ ok: false, error: 'Token is no longer active or secret mismatch.' });
      return;
    }

    // 3. Read tenant UniFi configuration from Firestore
    const configSnap = await db.doc(`organizations/${orgId}/settings/config`).get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiAgentConfig = configData?.unifi_agent || configData?.unifi_remote;

    const effectiveUnifiHost = unifiAgentConfig?.host || unifiHost || unifiAgentConfig?.auto_discovered_host || '';
    const unifiAccessToken = unifiAgentConfig?.access_token || '';
    const skipTlsVerify = unifiAgentConfig?.skip_tls_verify ?? true;

    // 4. Register or update the agent in Firestore
    const agentRef = db.doc(`agents/${agentId}`);
    await agentRef.set(
      {
        org_id: orgId,
        label: label || tokenData.label || 'Main Campus Agent',
        version: version || '1.0.0',
        status: 'online',
        registered_at: FieldValue.serverTimestamp(),
        last_heartbeat: FieldValue.serverTimestamp(),
        unifi_host: effectiveUnifiHost,
        capabilities: ['unlock', 'lock', 'door_sync'],
        token_id: tokenId,
      },
      { merge: true }
    );

    // If agent reported a host and none was recorded or it was auto-discovered, update config
    if (unifiHost && unifiAgentConfig) {
      await db.doc(`organizations/${orgId}/settings/config`).set(
        {
          unifi_agent: {
            ...unifiAgentConfig,
            auto_discovered_host: unifiHost,
          },
        },
        { merge: true }
      );
    }

    // 5. Create an authorized custom token for the agent
    const auth = getAuth();
    const customToken = await auth.createCustomToken(`agent:${orgId}:${agentId}`, {
      agent: true,
      orgId,
    });

    // 6. Audit log
    await db.collection(`organizations/${orgId}/audit_log`).add({
      action: 'agent_registered',
      agent_id: agentId,
      label: label || 'Main Campus Agent',
      token_id: tokenId,
      unifi_host: effectiveUnifiHost,
      timestamp: FieldValue.serverTimestamp(),
    });

    res.json({
      ok: true,
      orgId,
      agentId,
      customToken,
      projectId: process.env.GCLOUD_PROJECT || 'barnabasunfi',
      unifiHost: effectiveUnifiHost,
      unifiAccessToken,
      skipTlsVerify,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `Registration error: ${err.message}` });
  }
});
