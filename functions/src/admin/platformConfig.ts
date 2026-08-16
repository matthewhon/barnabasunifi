import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { invalidatePlatformConfigCache } from '../config/platform';
import type { AuthClaims } from '../types';

interface UpdatePlatformConfigRequest {
  pco_client_id?: string;
  pco_client_secret?: string;
  redirect_uri?: string;
}

/**
 * Callable Cloud Function — super_admin only.
 * Updates the PCO OAuth app credentials stored in Firestore platform_config/pco.
 * Also invalidates the in-memory cache so the next request picks up new values.
 */
export const updatePlatformConfig = onCall(async (request) => {
  const claims = request.auth?.token as AuthClaims | undefined;

  if (!claims || claims.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admins can update platform config.');
  }

  const data = request.data as UpdatePlatformConfigRequest;
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: request.auth!.uid,
    updated_at_server: FieldValue.serverTimestamp(),
  };

  if (data.pco_client_id !== undefined) {
    if (!data.pco_client_id.trim()) {
      throw new HttpsError('invalid-argument', 'pco_client_id cannot be empty.');
    }
    update.pco_client_id = data.pco_client_id.trim();
  }

  if (data.pco_client_secret !== undefined) {
    if (!data.pco_client_secret.trim()) {
      throw new HttpsError('invalid-argument', 'pco_client_secret cannot be empty.');
    }
    update.pco_client_secret = data.pco_client_secret.trim();
  }

  if (data.redirect_uri !== undefined) {
    update.redirect_uri = data.redirect_uri.trim();
  }

  const db = getFirestore();
  await db.collection('platform_config').doc('pco').set(update, { merge: true });

  // Bust the in-memory cache so next function invocation picks up new values
  invalidatePlatformConfigCache();

  return { success: true };
});

/**
 * Callable Cloud Function — super_admin only.
 * Returns the current platform config (with secret partially masked for display).
 */
export const getPlatformConfigCallable = onCall(async (request) => {
  const claims = request.auth?.token as AuthClaims | undefined;

  if (!claims || claims.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only super_admins can read platform config.');
  }

  const db = getFirestore();
  const snap = await db.collection('platform_config').doc('pco').get();

  if (!snap.exists) {
    return { exists: false };
  }

  const data = snap.data()!;
  const secret: string = data.pco_client_secret ?? '';

  return {
    exists: true,
    pco_client_id: data.pco_client_id ?? '',
    // Mask the secret — show first 8 chars + asterisks
    pco_client_secret_preview:
      secret.length > 8 ? `${secret.substring(0, 8)}${'*'.repeat(Math.min(24, secret.length - 8))}` : '********',
    redirect_uri: data.redirect_uri ?? '',
    updated_at: data.updated_at ?? null,
    updated_by: data.updated_by ?? null,
  };
});
