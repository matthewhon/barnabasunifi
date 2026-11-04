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
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { saveConfig } from './config';

let _db: any = null;
let _isInitialized = false;
let _useClientSdk = false;

const DEFAULT_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyCBu6tWWWx50VqSkTUGEAYy6fShFGIpZRk';

/**
 * Exchange a persistent CONNECTION_TOKEN for a fresh Firebase Custom Token.
 */
export async function refreshCustomTokenFromConnectionToken(): Promise<string | null> {
  const connectionToken = process.env.CONNECTION_TOKEN;
  if (!connectionToken) return null;

  try {
    const base64Str = connectionToken.replace(/^UPCO_/, '').trim();
    const raw = Buffer.from(base64Str, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    const endpoint =
      parsed.endpoint ||
      `https://us-central1-${parsed.projectId || 'barnabasunfi'}.cloudfunctions.net/registerAgentWithToken`;

    logger.info(`[Firebase] Refreshing custom auth token via connection token from ${endpoint}…`);
    const response = await axios.post(
      endpoint,
      {
        token: connectionToken,
        agentId: process.env.AGENT_ID || 'agent-main-campus',
        label: process.env.AGENT_LABEL || 'Main Campus Agent',
        unifiHost: process.env.UNIFI_HOST || '',
        version: process.env.npm_package_version || '1.0.0',
      },
      { timeout: 15000 }
    );

    if (response.data?.ok && response.data?.customToken) {
      const freshToken = String(response.data.customToken);
      saveConfig({ AGENT_AUTH_TOKEN: freshToken });
      return freshToken;
    }
  } catch (err: any) {
    logger.warn(`[Firebase] Failed to refresh custom token from connection token: ${err.message}`);
  }
  return null;
}

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
      _useClientSdk = false;
      _isInitialized = true;
      logger.info(`✓ Firebase initialized via Service Account for project: ${projectId}`);
      return;
    } catch (err) {
      logger.warn(`Failed to initialize via service account: ${err} — checking for auth token…`);
    }
  }

  // Fallback: Initialize via Firebase Client SDK with AGENT_AUTH_TOKEN (or refresh via CONNECTION_TOKEN)
  let authToken = process.env.AGENT_AUTH_TOKEN;
  if (!authToken && process.env.CONNECTION_TOKEN) {
    authToken = (await refreshCustomTokenFromConnectionToken()) || undefined;
  }

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
    } catch (err: any) {
      logger.warn(`Stored custom token rejected (${err.message}). Attempting refresh via CONNECTION_TOKEN…`);
      const refreshedToken = await refreshCustomTokenFromConnectionToken();
      if (!refreshedToken) {
        throw new Error(`Agent token authentication failed: ${err.message}`);
      }
      await firebase.auth().signInWithCustomToken(refreshedToken);
    }

    logger.info(`✓ Successfully authenticated agent with Firebase Auth via Connection Token.`);
    _db = firebase.firestore();
    _useClientSdk = true;
    _isInitialized = true;
    return;
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

/**
 * Returns a Firestore Timestamp implementation compatible with the active SDK
 * (firebase-admin vs firebase/compat client SDK).
 */
export const firestoreTimestamp = {
  now(): FirebaseFirestore.Timestamp {
    if (_useClientSdk) {
      return (firebase.firestore.Timestamp as any).now();
    }
    return admin.firestore.Timestamp.now();
  },
  fromMillis(ms: number): FirebaseFirestore.Timestamp {
    if (_useClientSdk) {
      return (firebase.firestore.Timestamp as any).fromMillis(ms);
    }
    return admin.firestore.Timestamp.fromMillis(ms);
  },
  fromDate(date: Date): FirebaseFirestore.Timestamp {
    if (_useClientSdk) {
      return (firebase.firestore.Timestamp as any).fromDate(date);
    }
    return admin.firestore.Timestamp.fromDate(date);
  },
};

export { admin };

export const db = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop) {
    return getDb()[prop as keyof FirebaseFirestore.Firestore];
  },
});
