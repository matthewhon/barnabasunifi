/**
 * firebase.ts
 * Firebase Admin SDK initialization.
 * Loads a service account JSON from disk and initializes the admin app.
 * Exports the Firestore db instance and the admin namespace.
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

let _db: FirebaseFirestore.Firestore | null = null;

/**
 * Initialize the Firebase Admin SDK using a service account file on disk.
 * Must be called once before using `db`.
 *
 * @param serviceAccountPath - Absolute or relative path to the service account JSON file.
 * @param projectId          - Firebase project ID (used as a sanity check).
 */
export function initializeFirebase(
  serviceAccountPath: string,
  projectId: string
): void {
  if (admin.apps.length > 0) {
    logger.warn('Firebase Admin SDK already initialized — skipping.');
    return;
  }

  const resolvedPath = path.resolve(serviceAccountPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Firebase service account file not found at: ${resolvedPath}\n` +
        `Set FIREBASE_SERVICE_ACCOUNT_PATH to the correct path.`
    );
  }

  let serviceAccount: admin.ServiceAccount;
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    serviceAccount = JSON.parse(raw) as admin.ServiceAccount;
  } catch (err) {
    throw new Error(
      `Failed to parse Firebase service account JSON at ${resolvedPath}: ${String(err)}`
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
  });

  logger.info(`Firebase initialized for project: ${projectId}`);
}

/**
 * Returns the Firestore database instance.
 * Throws if Firebase has not been initialized.
 */
export function getDb(): FirebaseFirestore.Firestore {
  if (!_db) {
    if (admin.apps.length === 0) {
      throw new Error(
        'Firebase has not been initialized. Call initializeFirebase() first.'
      );
    }
    _db = admin.firestore();
    // Use millisecond timestamps instead of Timestamp objects for convenience
    _db.settings({ ignoreUndefinedProperties: true });
  }
  return _db;
}

/**
 * Convenience getter — lazy-initializes the Firestore instance.
 */
export { admin };

export const db = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop) {
    return getDb()[prop as keyof FirebaseFirestore.Firestore];
  },
});
