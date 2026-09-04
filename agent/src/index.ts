/**
 * index.ts
 * Main entry point for the UnFi-PCO Local Agent.
 *
 * Boots an always-on Web Configuration & Management Portal on port 8080.
 * If credentials and configuration are present, starts the background bridge worker.
 * If configuration is incomplete, stays alive in setup mode and allows configuration
 * via the web portal.
 */

import 'dotenv/config';

import { getConfigurationStatus } from './config';
import { logger, setLogLevel } from './logger';
import { initializeFirebase, getDb } from './firebase';
import { UnifiAccessClient } from './unifi/access';
import { startHeartbeat } from './firebase/heartbeat';
import { syncDoors, startDoorSyncInterval } from './firebase/doorSync';
import { startCommandListener } from './firebase/commandListener';
import { startWebServer, AgentBridgeState } from './web/server';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Lifecycle State
// ---------------------------------------------------------------------------

let cleanupPreviousWorker: (() => void) | null = null;

const bridgeState: AgentBridgeState = {
  status: 'unconfigured',
  unifiConnected: false,
  firebaseConnected: false,
  doorCount: 0,
  lastSync: null,
  onRestartRequest: async () => {
    logger.info('[Bridge] Reload requested via Web Portal.');
    await startBridgeWorker();
  },
};

// ---------------------------------------------------------------------------
// Worker Launcher
// ---------------------------------------------------------------------------

async function startBridgeWorker(): Promise<void> {
  // Stop existing worker if one was running
  if (cleanupPreviousWorker) {
    try {
      cleanupPreviousWorker();
    } catch (err) {
      logger.warn(`[Bridge] Error cleaning up previous worker: ${err}`);
    }
    cleanupPreviousWorker = null;
  }

  const configStatus = getConfigurationStatus();

  if (!configStatus.isConfigured || !configStatus.config) {
    bridgeState.status = 'unconfigured';
    bridgeState.unifiConnected = false;
    bridgeState.firebaseConnected = false;
    bridgeState.errorMessage = `Missing: ${configStatus.missing.join(', ')}`;
    logger.warn(
      `⚠️ Agent is unconfigured (${bridgeState.errorMessage}). ` +
        `Open http://localhost:${process.env.PORT || 8080} to configure.`
    );
    return;
  }

  const config = configStatus.config;
  setLogLevel(config.logLevel);

  logger.info('═══════════════════════════════════════════════');
  logger.info('  UnFi-PCO Local Agent');
  logger.info(`  Version : ${config.version}`);
  logger.info(`  Org     : ${config.orgId}`);
  logger.info(`  Agent   : ${config.agentId} (${config.agentLabel})`);
  logger.info(`  UniFi   : ${config.unifiHost}`);
  logger.info('═══════════════════════════════════════════════');

  bridgeState.status = 'starting';

  // 1. Initialize Firebase
  try {
    await initializeFirebase(config.firebaseServiceAccountPath, config.firebaseProjectId);
    bridgeState.firebaseConnected = true;
  } catch (err: any) {
    bridgeState.status = 'error';
    bridgeState.firebaseConnected = false;
    bridgeState.errorMessage = `Firebase initialization failed: ${err.message}`;
    logger.error(`[Bridge] Firebase init error: ${err.message}`);
    return;
  }

  const db = getDb();

  // 2. Initialize UniFi Access client
  const unifiClient = new UnifiAccessClient(
    config.unifiHost,
    config.unifiAccessToken,
    config.skipTlsVerify
  );

  // 3. Test UniFi connectivity
  logger.info('Testing UniFi Access connection…');
  try {
    const connected = await unifiClient.testConnection();
    if (!connected) {
      bridgeState.status = 'error';
      bridgeState.unifiConnected = false;
      bridgeState.errorMessage = 'Could not connect to UniFi Access API. Check host & token.';
      logger.error(
        '[Bridge] Could not connect to UniFi Access API. ' +
          'Check UNIFI_HOST, UNIFI_ACCESS_TOKEN, and network reachability.'
      );
      return;
    }
    bridgeState.unifiConnected = true;
  } catch (err: any) {
    bridgeState.status = 'error';
    bridgeState.unifiConnected = false;
    bridgeState.errorMessage = `UniFi connection error: ${err.message}`;
    logger.error(`[Bridge] UniFi connection error: ${err.message}`);
    return;
  }

  // 4. Register / update agent document in Firestore
  try {
    await db.doc(`agents/${config.agentId}`).set(
      {
        org_id: config.orgId,
        label: config.agentLabel,
        version: config.version,
        status: 'online',
        registered_at: admin.firestore.Timestamp.now(),
        unifi_host: config.unifiHost,
        capabilities: ['unlock', 'lock', 'door_sync'],
      },
      { merge: true }
    );
    logger.info(`Agent document registered: agents/${config.agentId}`);
  } catch (err) {
    logger.error(`Failed to register agent document: ${String(err)}`);
  }

  // 5. Start heartbeat
  const stopHeartbeat = startHeartbeat(
    config.orgId,
    config.agentId,
    config.agentLabel,
    config.version,
    config.heartbeatIntervalMs
  );

  // 6. Initial door sync
  logger.info('Running initial door sync…');
  try {
    const doors = await unifiClient.getDoors();
    bridgeState.doorCount = doors.length;
    await syncDoors(config.orgId, unifiClient);
    bridgeState.lastSync = new Date();
  } catch (err: any) {
    logger.error(`[DoorSync] Initial sync error: ${err.message}`);
  }

  // 7. Recurring door sync
  const stopDoorSync = startDoorSyncInterval(
    config.orgId,
    unifiClient,
    config.doorSyncIntervalMs
  );

  // 8. Start Firestore command listener
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

  bridgeState.status = 'running';
  bridgeState.errorMessage = undefined;
  logger.info('✓ Agent bridge running — listening for door commands.');

  cleanupPreviousWorker = () => {
    logger.info('[Bridge] Stopping previous bridge worker…');
    stopCommandListener();
    stopDoorSync();
    stopHeartbeat();
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '8080', 10);

  // 1. Launch the web configuration portal immediately
  startWebServer(port, bridgeState);

  // 2. Start bridge worker (will run if configured, or stay in setup mode)
  await startBridgeWorker();

  // 3. Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal} — shutting down gracefully.`);
    if (cleanupPreviousWorker) {
      cleanupPreviousWorker();
    }
    process.exit(0);
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.error(`[FATAL] Startup failure: ${String(err)}`);
});
