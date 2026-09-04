/**
 * firebase.ts
 * Firebase connection initialization.
 * Supports BOTH:
 *  1. Service Account JSON file (Admin SDK)
 *  2. Connection Token / Custom Token (Firebase Client SDK via Custom Token)
 */

import * as admin from 'firebase-admin';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import 'firebase/compat/auth';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

let _db: any = null;
let _isInitialized = false;

const DEFAULT_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyCBu6tWWWx50VqSkTUGEAYy6fShFGIpZRk';

/**
 * Initialize Firebase connection.
 * Checks for service-account.json first; if absent, uses AGENT_AUTH_TOKEN custom token.
 */
export async function initializeFirebase(
  serviceAccountPath: string,
  projectId: string
): Promise<void> {
  if (_isInitialized) {
    logger.warn('Firebase already initialized — skipping.');
    return;
  }

  const resolvedPath = path.resolve(serviceAccountPath);
  const hasServiceAccount =
    fs.existsSync(resolvedPath) &&
    !fs.statSync(resolvedPath).isDirectory() &&
    fs.readFileSync(resolvedPath, 'utf-8').includes('private_key');

  if (hasServiceAccount) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const serviceAccount = JSON.parse(raw) as admin.ServiceAccount;

      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId,
        });
      }

      _db = admin.firestore();
      _db.settings({ ignoreUndefinedProperties: true });
      _isInitialized = true;
      logger.info(`✓ Firebase initialized via Service Account for project: ${projectId}`);
      return;
    } catch (err) {
      logger.warn(`Failed to initialize via service account: ${err} — checking for auth token…`);
    }
  }

  // Fallback: Initialize via Firebase Client SDK with AGENT_AUTH_TOKEN
  const authToken = process.env.AGENT_AUTH_TOKEN;
  if (authToken) {
    logger.info(`Connecting to Firebase using Agent Connection Token for project: ${projectId}…`);
    if (firebase.apps.length === 0) {
      firebase.initializeApp({
        apiKey: DEFAULT_API_KEY,
        projectId,
        authDomain: `${projectId}.firebaseapp.com`,
      });
    }

    try {
      await firebase.auth().signInWithCustomToken(authToken);
      logger.info(`✓ Successfully authenticated agent with Firebase Auth via Connection Token.`);
      _db = firebase.firestore();
      _isInitialized = true;
      return;
    } catch (err: any) {
      logger.error(`Failed to authenticate with custom token: ${err.message}`);
      throw new Error(`Agent token authentication failed: ${err.message}`);
    }
  }

  throw new Error(
    `No valid Firebase credentials found. Provide a Connection Token or service-account.json.`
  );
}

/**
 * Returns the Firestore database instance.
 */
export function getDb(): FirebaseFirestore.Firestore {
  if (!_db) {
    throw new Error('Firebase has not been initialized. Call initializeFirebase() first.');
  }
  return _db;
}

export { admin };

export const db = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop) {
    return getDb()[prop as keyof FirebaseFirestore.Firestore];
  },
});
