import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as crypto from 'crypto';

interface IssueCameraStreamSessionRequest {
  orgId: string;
  cameraId: string;
  mode?: 'live' | 'event';
}

interface IssueCameraStreamSessionResponse {
  camera_id: string;
  stream_mode: 'snapshot' | 'webrtc_lan' | 'relay';
  snapshot_url: string | null;
  snapshot_updated_at: string | null;
  last_event_snapshot_url: string | null;
  last_event_at: string | null;
  last_event_label: string | null;
  webrtc_url: string | null;
  mse_url: string | null;
  stream_token: string | null;
  allow_notifications: boolean;
  onsite_only: boolean;
  expires_at: string;
}

function normalizeIp(rawIp: string | undefined | null): string {
  if (!rawIp) return '';
  const first = rawIp.split(',')[0].trim();
  return first.startsWith('::ffff:') ? first.slice(7) : first;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0;
}

function ipMatchesAllowlist(clientIp: string, allowlist: string[]): boolean {
  if (!clientIp) return false;
  for (const entry of allowlist) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed === clientIp) return true;
    if (trimmed.includes('/')) {
      const [base, maskStr] = trimmed.split('/');
      const maskBits = Number(maskStr);
      const clientInt = ipv4ToInt(clientIp);
      const baseInt = ipv4ToInt(base);
      if (
        clientInt !== null &&
        baseInt !== null &&
        Number.isInteger(maskBits) &&
        maskBits >= 0 &&
        maskBits <= 32
      ) {
        const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
        if ((clientInt & mask) === (baseInt & mask)) {
          return true;
        }
      }
    }
  }
  return false;
}

function signStreamToken(
  secret: string,
  payload: { orgId: string; cameraId: string; uid: string; exp: number }
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Callable Cloud Function: issueCameraStreamSession
 *
 * Enforces per-user camera allowlists, onsite-only IP restrictions, and
 * notification restrictions before issuing short-lived snapshot / stream access.
 */
export const issueCameraStreamSession = onCall<
  IssueCameraStreamSessionRequest,
  Promise<IssueCameraStreamSessionResponse>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to view cameras.');
  }

  const { orgId, cameraId, mode = 'live' } = request.data || {};
  if (!orgId || !cameraId) {
    throw new HttpsError('invalid-argument', 'orgId and cameraId are required.');
  }

  const uid = request.auth.uid;
  const claims = request.auth.token;
  const db = getFirestore();

  // Verify org membership
  const isSuperAdmin = claims.role === 'super_admin';
  let userRole: string | null = isSuperAdmin
    ? 'super_admin'
    : claims.orgId === orgId && typeof claims.role === 'string'
      ? claims.role
      : null;

  if (!userRole) {
    const userDoc = await db.doc(`users/${uid}`).get();
    const memberships = userDoc.data()?.org_memberships;
    if (memberships && !Array.isArray(memberships) && memberships[orgId]?.role) {
      userRole = memberships[orgId].role;
    } else if (Array.isArray(memberships)) {
      const match = memberships.find((m: { org_id?: string }) => m.org_id === orgId);
      userRole = match?.role ?? null;
    }
  }

  if (!userRole || !['super_admin', 'org_admin', 'manager', 'viewer', 'camera_viewer'].includes(userRole)) {
    throw new HttpsError('permission-denied', 'You do not belong to this organization.');
  }

  const isAdmin = userRole === 'super_admin' || userRole === 'org_admin';

  // Load user's camera permissions
  const permSnap = await db.doc(`organizations/${orgId}/camera_permissions/${uid}`).get();
  const perm = permSnap.exists
    ? permSnap.data()!
    : isAdmin
      ? { access_mode: 'all', allowed_camera_ids: [], onsite_only: false, allow_notifications: true }
      : { access_mode: 'none', allowed_camera_ids: [], onsite_only: false, allow_notifications: false };

  const accessMode = (perm.access_mode as string) || 'none';
  const allowedIds = Array.isArray(perm.allowed_camera_ids) ? (perm.allowed_camera_ids as string[]) : [];
  const onsiteOnly = Boolean(perm.onsite_only);
  const allowNotifications = perm.allow_notifications !== false;

  if (!isAdmin) {
    if (accessMode === 'none') {
      throw new HttpsError('permission-denied', 'You do not have permission to view cameras.');
    }
    if (accessMode === 'selected' && !allowedIds.includes(cameraId)) {
      throw new HttpsError('permission-denied', 'You do not have permission to view this camera.');
    }
  }

  // Load org Protect settings
  const settingsSnap = await db.doc(`organizations/${orgId}/settings/config`).get();
  const protectCfg = settingsSnap.data()?.unifi_protect || {};

  // Enforce onsite-only restriction if enabled for this user
  if (onsiteOnly) {
    const rawHeader = request.rawRequest?.headers?.['x-forwarded-for'];
    const clientIp = normalizeIp(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader || request.rawRequest?.ip);

    const allowlist: string[] = Array.isArray(protectCfg.onsite_public_ips)
      ? [...protectCfg.onsite_public_ips]
      : [];

    // Also include public IPs reported by online agents for this org
    const agentsSnap = await db
      .collection('agents')
      .where('org_id', '==', orgId)
      .where('status', '==', 'online')
      .get();
    for (const agentDoc of agentsSnap.docs) {
      const pubIp = agentDoc.data()?.public_ip;
      if (typeof pubIp === 'string' && pubIp.trim()) {
        allowlist.push(pubIp.trim());
      }
    }

    if (!ipMatchesAllowlist(clientIp, allowlist)) {
      throw new HttpsError(
        'permission-denied',
        'ONSITE_REQUIRED: You must be on the church network to view this camera.'
      );
    }
  }

  // Load camera doc
  const camRef = db.doc(`organizations/${orgId}/cameras/${cameraId}`);
  const camSnap = await camRef.get();
  if (!camSnap.exists) {
    throw new HttpsError('not-found', 'Camera not found.');
  }
  const camData = camSnap.data()!;

  // Mark active viewer lease (60s) only when viewing live stream
  const nowMs = Date.now();
  const expiresAtIso = new Date(nowMs + 60_000).toISOString();
  if (mode !== 'event') {
    await camRef.set({ live_view_until: expiresAtIso }, { merge: true });
  }

  // Issue short-lived signed URLs for latest snapshot and last event snapshot
  let snapshotUrl: string | null = null;
  let lastEventSnapshotUrl: string | null = null;
  const storagePath =
    (camData.snapshot_storage_path as string) || `organizations/${orgId}/cameras/${cameraId}/latest.jpg`;
  const lastEventPath =
    (camData.last_event_storage_path as string) || `organizations/${orgId}/cameras/${cameraId}/last_event.jpg`;
  try {
    const bucket = getStorage().bucket();
    const eventFile = bucket.file(lastEventPath);
    const [eventExists] = await eventFile.exists();
    if (eventExists) {
      const [eventSigned] = await eventFile.getSignedUrl({
        action: 'read',
        expires: nowMs + 120_000,
      });
      lastEventSnapshotUrl = eventSigned;
    }
    if (mode !== 'event' || !lastEventSnapshotUrl) {
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        const [signed] = await file.getSignedUrl({
          action: 'read',
          expires: nowMs + 60_000,
        });
        snapshotUrl = signed;
      }
    }
  } catch {
    snapshotUrl = null;
    lastEventSnapshotUrl = null;
  }

  // Build WebRTC / MSE URLs when configured
  const streamMode = (protectCfg.stream_mode as 'snapshot' | 'webrtc_lan' | 'relay') || 'snapshot';
  let webrtcUrl: string | null = null;
  let mseUrl: string | null = null;
  let streamToken: string | null = null;

  if (streamMode === 'webrtc_lan' || streamMode === 'relay') {
    const secret = String(protectCfg.api_key || orgId);
    streamToken = signStreamToken(secret, {
      orgId,
      cameraId: String(camData.unifi_camera_id || cameraId),
      uid,
      exp: Math.floor((nowMs + 120_000) / 1000),
    });

    if (streamMode === 'relay' && protectCfg.stream_base_url) {
      const base = String(protectCfg.stream_base_url).replace(/\/+$/, '');
      const camStreamName = encodeURIComponent(String(camData.unifi_camera_id || cameraId));
      webrtcUrl = `${base}/api/webrtc?src=${camStreamName}&token=${encodeURIComponent(streamToken)}`;
      mseUrl = `${base.replace(/^http/, 'ws')}/api/ws?src=${camStreamName}&token=${encodeURIComponent(streamToken)}`;
    } else if (streamMode === 'webrtc_lan') {
      const agentsSnap = await db
        .collection('agents')
        .where('org_id', '==', orgId)
        .where('status', '==', 'online')
        .limit(1)
        .get();
      const localIp = agentsSnap.docs[0]?.data()?.local_ip;
      if (localIp) {
        const camStreamName = encodeURIComponent(String(camData.unifi_camera_id || cameraId));
        webrtcUrl = `http://${localIp}:1984/api/webrtc?src=${camStreamName}&token=${encodeURIComponent(streamToken)}`;
        mseUrl = `ws://${localIp}:1984/api/ws?src=${camStreamName}&token=${encodeURIComponent(streamToken)}`;
      }
    }
  }

  return {
    camera_id: cameraId,
    stream_mode: streamMode,
    snapshot_url: snapshotUrl,
    snapshot_updated_at: (camData.snapshot_updated_at as string) || null,
    last_event_snapshot_url: lastEventSnapshotUrl,
    last_event_at: (camData.last_event_at as string) || null,
    last_event_label: (camData.last_event_label as string) || null,
    webrtc_url: webrtcUrl,
    mse_url: mseUrl,
    stream_token: streamToken,
    allow_notifications: allowNotifications,
    onsite_only: onsiteOnly,
    expires_at: expiresAtIso,
  };
});

export const getAccessLogSnapshotUrl = onCall<
  { orgId: string; logId: string },
  Promise<{ url: string | null; captured_at: string | null; camera_id: string | null }>
>({ cors: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const { orgId, logId } = request.data || {};
  if (!orgId || !logId) {
    throw new HttpsError('invalid-argument', 'orgId and logId are required.');
  }

  const claims = request.auth.token as Record<string, unknown>;
  const uid = request.auth.uid;
  const db = getFirestore();

  const claimOrgId = claims.orgId as string | undefined;
  const role = claims.role as string | undefined;
  let isMember = role === 'super_admin' || (claimOrgId === orgId && role !== 'camera_viewer');

  if (!isMember) {
    const userSnap = await db.doc(`users/${uid}`).get();
    const memberships = (userSnap.data()?.org_memberships as Array<{ org_id: string; role?: string }>) || [];
    isMember = memberships.some((m) => m.org_id === orgId && m.role !== 'camera_viewer');
  }

  if (!isMember) {
    throw new HttpsError('permission-denied', 'You do not have permission to view access log snapshots.');
  }

  const logSnap = await db.doc(`organizations/${orgId}/access_logs/${logId}`).get();
  if (!logSnap.exists) {
    throw new HttpsError('not-found', 'Access log entry not found.');
  }

  const logData = logSnap.data()!;
  const storagePath = logData.snapshot_storage_path as string | undefined;
  if (!storagePath) {
    return { url: null, captured_at: null, camera_id: null };
  }

  const file = getStorage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    return { url: null, captured_at: null, camera_id: (logData.snapshot_camera_id as string) || null };
  }

  const [signed] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 5 * 60_000,
  });

  return {
    url: signed,
    captured_at: (logData.snapshot_captured_at as string) || null,
    camera_id: (logData.snapshot_camera_id as string) || null,
  };
});
