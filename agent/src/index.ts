/**
 * index.ts
 * Main entry point for the UnFi-PCO Local Agent.
 *
 * Boot sequence:
 *  1. Load .env
 *  2. Load and validate config
 *  3. Initialize Firebase Admin SDK
 *  4. Initialize UniFi Access API client
 *  5. Test UniFi connectivity — exit if unreachable
 *  6. Register / update agent document in Firestore
 *  7. Start heartbeat
 *  8. Run initial door sync
 *  9. Start recurring door sync interval
 * 10. Start Firestore command listener
 * 11. Log "Agent running"
 */

import 'dotenv/config';

import { loadConfig } from './config';
import { logger, setLogLevel } from './logger';
import { initializeFirebase, getDb } from './firebase';
import { UnifiAccessClient } from './unifi/access';
import { startHeartbeat } from './firebase/heartbeat';
import { syncDoors, startDoorSyncInterval } from './firebase/doorSync';
import { startCommandListener } from './firebase/commandListener';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // ── 1. Load config ──────────────────────────────────────────────────────
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    // Logger may not be configured yet; use console.error
    console.error(`[FATAL] Configuration error: ${String(err)}`);
    process.exit(1);
  }

  // Apply configured log level now that config is available
  setLogLevel(config.logLevel);

  logger.info('═══════════════════════════════════════════════');
  logger.info('  UnFi-PCO Local Agent');
  logger.info(`  Version : ${config.version}`);
  logger.info(`  Org     : ${config.orgId}`);
  logger.info(`  Agent   : ${config.agentId} (${config.agentLabel})`);
  logger.info(`  UniFi   : ${config.unifiHost}`);
  logger.info('═══════════════════════════════════════════════');

  // ── 2. Initialize Firebase ───────────────────────────────────────────────
  try {
    initializeFirebase(config.firebaseServiceAccountPath, config.firebaseProjectId);
  } catch (err) {
    logger.error(`[FATAL] Firebase initialization failed: ${String(err)}`);
    process.exit(1);
  }

  const db = getDb();

  // ── 3. Initialize UniFi Access client ───────────────────────────────────
  const unifiClient = new UnifiAccessClient(
    config.unifiHost,
    config.unifiAccessToken,
    config.skipTlsVerify
  );

  // ── 4. Test UniFi connectivity ───────────────────────────────────────────
  logger.info('Testing UniFi Access connection…');
  const connected = await unifiClient.testConnection();
  if (!connected) {
    logger.error(
      '[FATAL] Could not connect to UniFi Access API. ' +
        'Check UNIFI_HOST, UNIFI_ACCESS_TOKEN, and network reachability. ' +
        (config.skipTlsVerify
          ? ''
          : 'If using a self-signed cert, set SKIP_TLS_VERIFY=true.')
    );
    process.exit(1);
  }

  // ── 5. Register / update agent document in Firestore ────────────────────
  try {
    await db.doc(`agents/${config.agentId}`).set(
      {
        org_id: config.orgId,
        label: config.agentLabel,
        version: config.version,
        status: 'starting',
        registered_at: admin.firestore.Timestamp.now(),
        unifi_host: config.unifiHost,
        capabilities: ['unlock', 'lock', 'door_sync'],
      },
      { merge: true }
    );
    logger.info(`Agent document registered: agents/${config.agentId}`);
  } catch (err) {
    logger.error(`Failed to register agent document: ${String(err)}`);
    // Non-fatal — continue starting up
  }

  // ── 6. Start heartbeat ───────────────────────────────────────────────────
  const stopHeartbeat = startHeartbeat(
    config.orgId,
    config.agentId,
    config.agentLabel,
    config.version,
    config.heartbeatIntervalMs
  );

  // ── 7. Initial door sync ─────────────────────────────────────────────────
  logger.info('Running initial door sync…');
  await syncDoors(config.orgId, unifiClient);

  // ── 8. Start recurring door sync ─────────────────────────────────────────
  const stopDoorSync = startDoorSyncInterval(
    config.orgId,
    unifiClient,
    config.doorSyncIntervalMs
  );

  // ── 9. Start Firestore command listener ──────────────────────────────────
  const stopCommandListener = startCommandListener(
    config.orgId,
    config.agentId,
    unifiClient,
    (cmd) => {
      logger.debug(
        `[Main] Command callback — id: ${cmd.id} action: ${cmd.action} door: ${cmd.door_id}`
      );
    }
  );

  // ── 10. Ready ─────────────────────────────────────────────────────────────
  logger.info('✓ Agent running — listening for door commands.');

  // ── 11. Graceful shutdown ─────────────────────────────────────────────────
  const cleanup = (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully.`);
    stopCommandListener();
    stopDoorSync();
    stopHeartbeat(); // writes 'offline' status and calls process.exit(0)
  };

  // Note: SIGINT and SIGTERM are also handled by the heartbeat module,
  // which calls process.exit(0) after marking offline. We register here
  // as well so stopCommandListener / stopDoorSync run first.
  process.once('SIGINT', () => cleanup('SIGINT'));
  process.once('SIGTERM', () => cleanup('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('[FATAL] Unhandled error during startup:', err);
  process.exit(1);
});
