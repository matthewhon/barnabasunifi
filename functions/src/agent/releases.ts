import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'crypto';

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

/**
 * uploadAgentRelease — HTTPS endpoint to upload agent release zip and publish it.
 * Accepts POST JSON: { version, zipBase64, changelog, secret }
 */
export const uploadAgentRelease = onRequest({ cors: true, maxInstances: 2 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const { version, zipBase64, changelog = '', secret } = req.body || {};
  if (!secret || secret !== (process.env.RELEASE_SECRET || 'UPCO_AGENT_OTA_2026')) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  if (!version || !zipBase64) {
    res.status(400).json({ ok: false, error: 'version and zipBase64 are required' });
    return;
  }

  try {
    const zipBuffer = Buffer.from(zipBase64, 'base64');
    const projectId = process.env.GCLOUD_PROJECT || 'barnabasunfi';
    const directDownloadUrl = `https://us-central1-${projectId}.cloudfunctions.net/downloadAgentRelease?version=${version}`;

    let downloadUrl = directDownloadUrl;
    try {
      const bucket = getStorage().bucket('barnabasunfi.firebasestorage.app');
      const filename = `agent-releases/agent-v${version}.zip`;
      const file = bucket.file(filename);
      const token = randomUUID();
      await file.save(zipBuffer, {
        contentType: 'application/zip',
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${token}`;
    } catch (storageErr) {
      console.warn(`[Releases] Cloud Storage upload fallback to direct download URL: ${directDownloadUrl}`);
    }

    const db = getFirestore();
    const now = FieldValue.serverTimestamp();
    const releaseData = {
      version,
      download_url: downloadUrl,
      zip_base64: zipBase64,
      changelog: changelog || `Agent release v${version}`,
      published_at: now,
      updated_at: now,
      published_by: 'cli',
      file_size_bytes: zipBuffer.length,
    };

    const batch = db.batch();
    batch.set(db.doc(`agent_releases/${version}`), releaseData);
    batch.set(db.doc('agent_releases/latest'), releaseData);
    await batch.commit();

    console.log(`[Releases] Successfully uploaded & published agent release v${version}`);
    res.json({ ok: true, version, downloadUrl, size: zipBuffer.length });
  } catch (err: any) {
    console.error(`[Releases] Error uploading release:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * downloadAgentRelease — Serves the agent release zip directly via HTTP GET.
 */
export const downloadAgentRelease = onRequest({ cors: true }, async (req, res) => {
  const version = (req.query.version as string) || 'latest';
  try {
    const db = getFirestore();
    const docPath = version === 'latest' ? 'agent_releases/latest' : `agent_releases/${version}`;
    const snap = await db.doc(docPath).get();
    if (!snap.exists) {
      res.status(404).send('Release not found');
      return;
    }

    const data = snap.data()!;
    if (data.zip_base64) {
      const buffer = Buffer.from(data.zip_base64, 'base64');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="agent-v${data.version || version}.zip"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
      return;
    }

    if (data.download_url) {
      res.redirect(data.download_url);
      return;
    }

    res.status(404).send('No binary found for this release');
  } catch (err: any) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

