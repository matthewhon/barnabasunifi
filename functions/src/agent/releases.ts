import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export interface AgentRelease {
  version: string;
  download_url: string;
  changelog: string;
  published_at: string;
  published_by: string;
  file_size_bytes?: number;
}

/**
 * publishAgentRelease — Super admin only.
 * Creates a release record in Firestore. The zip must already be uploaded to
 * Firebase Storage and a signed download URL provided.
 */
export const publishAgentRelease = onCall<{
  version: string;
  download_url: string;
  changelog?: string;
  file_size_bytes?: number;
}>(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const role = request.auth.token.role as string | undefined;
  if (role !== 'super_admin') throw new HttpsError('permission-denied', 'Only super admins can publish agent releases.');

  const { version, download_url, changelog = '', file_size_bytes } = request.data ?? {};
  if (!version || !download_url) throw new HttpsError('invalid-argument', 'version and download_url are required.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new HttpsError('invalid-argument', 'version must be in format X.Y.Z');

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const releaseData: Record<string, any> = {
    version,
    download_url,
    changelog,
    published_at: now,
    updated_at: now,
    published_by: request.auth.uid,
    ...(file_size_bytes !== undefined ? { file_size_bytes } : {}),
  };

  const batch = db.batch();
  batch.set(db.doc(`agent_releases/${version}`), releaseData);
  batch.set(db.doc('agent_releases/latest'), releaseData);
  await batch.commit();

  console.log(`[Releases] Published agent release v${version} by ${request.auth.uid}`);
  return { success: true, version };
});

/**
 * getLatestAgentRelease — Any authenticated user (agents + dashboard).
 * Returns the latest release metadata so agents can check for updates.
 */
export const getLatestAgentRelease = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');

  const db = getFirestore();
  const snap = await db.doc('agent_releases/latest').get();
  if (!snap.exists) return { available: false };

  const data = snap.data()!;
  return {
    available: true,
    version: data.version as string,
    download_url: data.download_url as string,
    changelog: data.changelog as string,
    published_at: data.published_at?.toDate?.()?.toISOString?.() ?? data.published_at,
    file_size_bytes: data.file_size_bytes,
  };
});

/**
 * listAgentReleases — Super admin only.
 * Returns all published releases for the history table.
 */
export const listAgentReleases = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const role = request.auth.token.role as string | undefined;
  if (role !== 'super_admin') throw new HttpsError('permission-denied', 'Only super admins can list releases.');

  const db = getFirestore();
  const snap = await db.collection('agent_releases')
    .orderBy('published_at', 'desc')
    .limit(20)
    .get();

  const releases = snap.docs
    .filter((d) => d.id !== 'latest')
    .map((d) => {
      const data = d.data();
      return {
        version: data.version,
        changelog: data.changelog,
        published_at: data.published_at?.toDate?.()?.toISOString?.() ?? data.published_at,
        published_by: data.published_by,
        file_size_bytes: data.file_size_bytes,
      };
    });

  return { releases };
});
