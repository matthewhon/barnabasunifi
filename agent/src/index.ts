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

import { getConfigurationStatus, saveConfig } from './config';
import { logger, setLogLevel } from './logger';
import { initializeFirebase, getDb } from './firebase';
import { UnifiAccessClient } from './unifi/access';
import { startHeartbeat } from './firebase/heartbeat';
import { syncDoors, startDoorSyncInterval } from './firebase/doorSync';
import { syncSchedules, startScheduleSyncInterval } from './firebase/scheduleSync';
import { syncVisitors, startVisitorSyncInterval } from './firebase/visitorSync';
import { startCommandListener } from './firebase/commandListener';
import { startUpdateChecker } from './firebase/updateChecker';
import { startWebServer, AgentBridgeState } from './web/server';
import { autoDiscoverUnifiConsole } from './web/scanner';
import axios from 'axios';
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
    logger.info('[Bridge] Reload/restart requested — exiting process for supervisor/Docker reboot…');
    setTimeout(() => {
      process.exit(0);
    }, 500);
  },
};

/**
 * Automatically exchange CONNECTION_TOKEN with Cloud Functions to configure the agent.
 */
async function attemptAutoRegistration(connectionToken: string): Promise<boolean> {
  try {
    const base64Str = connectionToken.replace(/^UPCO_/, '').trim();
    const raw = Buffer.from(base64Str, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    const endpoint =
      parsed.endpoint ||
      `https://us-central1-${parsed.projectId || 'barnabasunfi'}.cloudfunctions.net/registerAgentWithToken`;

    logger.info(`[AutoRegister] Discovered CONNECTION_TOKEN. Contacting pairing endpoint: ${endpoint}…`);

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

    if (response.data?.ok) {
      const { orgId, customToken, projectId, unifiHost, unifiAccessToken, skipTlsVerify } = response.data;
      logger.info(`[AutoRegister] ✓ Paired successfully with Organization: ${orgId}`);

      saveConfig({
        ORG_ID: orgId,
        FIREBASE_PROJECT_ID: projectId || 'barnabasunfi',
        AGENT_AUTH_TOKEN: customToken,
        ...(unifiHost ? { UNIFI_HOST: unifiHost } : {}),
        ...(unifiAccessToken ? { UNIFI_ACCESS_TOKEN: unifiAccessToken } : {}),
        ...(skipTlsVerify !== undefined ? { SKIP_TLS_VERIFY: String(skipTlsVerify) } : {}),
      });
      return true;
    } else {
      logger.warn(`[AutoRegister] Pairing failed: ${response.data?.error || 'Unknown error'}`);
    }
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message;
    logger.warn(`[AutoRegister] Pairing handshake error: ${msg}`);
  }
  return false;
}

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

  let configStatus = getConfigurationStatus();

  // 1. If not yet fully configured but Connection Token is present, attempt auto-pairing handshake
  if (!configStatus.isConfigured && configStatus.canAutoRegister) {
    const token = process.env.CONNECTION_TOKEN || configStatus.config?.connectionToken;
    if (token) {
      await attemptAutoRegistration(token);
      configStatus = getConfigurationStatus();
    }
  }

  // 2. If token is present but host is missing, auto-scan local subnets to discover console
  if (
    !configStatus.isConfigured &&
    process.env.UNIFI_ACCESS_TOKEN &&
    (!process.env.UNIFI_HOST || configStatus.missing.some((m) => m.startsWith('UNIFI_HOST')))
  ) {
    logger.info('[Bridge] UniFi Host URL not set. Scanning local network for UniFi Access console…');
    const discovered = await autoDiscoverUnifiConsole(process.env.UNIFI_ACCESS_TOKEN);
    if (discovered) {
      logger.info(`[Bridge] Discovered UniFi Access console on LAN at: ${discovered}`);
      saveConfig({ UNIFI_HOST: discovered });
      configStatus = getConfigurationStatus();
    }
  }

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
  logger.info(`  UniFi   : ${config.unifiHost || '(Scanning network...)'}`);
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

  // 3. Test UniFi connectivity with auto-discovery fallback
  logger.info('Testing UniFi Access connection…');
  try {
    let connected = await unifiClient.testConnection();
    if (!connected) {
      logger.warn(`[Bridge] Could not connect to configured host (${config.unifiHost}). Scanning LAN for active console…`);
      const discovered = await autoDiscoverUnifiConsole(config.unifiAccessToken);
      if (discovered && discovered !== config.unifiHost) {
        logger.info(`[Bridge] Discovered active console on LAN at: ${discovered}. Connecting…`);
        config.unifiHost = discovered;
        saveConfig({ UNIFI_HOST: discovered });
        unifiClient.updateCredentials(discovered, config.unifiAccessToken, config.skipTlsVerify);
        connected = await unifiClient.testConnection();
      }
    }

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

  // 5b. Start OTA update checker (polls every 60s, listens real-time for approvals)
  const stopUpdateChecker = startUpdateChecker(
    config.agentId,
    config.orgId,
    60 * 1000,
    bridgeState.onRestartRequest
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

  // 8. Initial schedule sync
  logger.info('Running initial schedule sync…');
  try {
    const schedules = await syncSchedules(config.orgId, unifiClient);
    logger.info(`[ScheduleSync] Initial sync completed (${schedules.length} schedules found).`);
  } catch (err: any) {
    logger.error(`[ScheduleSync] Initial sync error: ${err.message}`);
  }

  // 9. Recurring schedule sync (every 15 minutes)
  const stopScheduleSync = startScheduleSyncInterval(
    config.orgId,
    unifiClient,
    15 * 60 * 1000
  );

  // 10. Initial visitor sync
  logger.info('Running initial visitor sync…');
  try {
    const visitors = await syncVisitors(config.orgId, unifiClient);
    logger.info(`[VisitorSync] Initial sync completed (${visitors.length} visitors found).`);
  } catch (err: any) {
    logger.error(`[VisitorSync] Initial sync error: ${err.message}`);
  }

  // 11. Recurring visitor sync (every 15 minutes)
  const stopVisitorSync = startVisitorSyncInterval(
    config.orgId,
    unifiClient,
    15 * 60 * 1000
  );

  // 12. Start Firestore command listener
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

  // 9. Subscribe to real-time cloud settings updates (token rotation, host changes)
  const stopSettingsListener = db.doc(`organizations/${config.orgId}/settings/config`).onSnapshot(
    async (snap: any) => {
      if (!snap.exists) return;
      const data = snap.data();
      const unifiConfig = data?.unifi_agent || data?.unifi_remote;
      if (!unifiConfig) return;

      let changed = false;
      if (unifiConfig.access_token && unifiConfig.access_token !== config.unifiAccessToken) {
        logger.info('[Bridge] Detected updated UniFi Access API token in cloud settings. Updating…');
        config.unifiAccessToken = unifiConfig.access_token;
        saveConfig({ UNIFI_ACCESS_TOKEN: unifiConfig.access_token });
        changed = true;
      }

      if (unifiConfig.host && unifiConfig.host !== config.unifiHost) {
        logger.info(`[Bridge] Detected updated UniFi Host (${unifiConfig.host}) in cloud settings. Updating…`);
        config.unifiHost = unifiConfig.host;
        saveConfig({ UNIFI_HOST: unifiConfig.host });
        changed = true;
      }

      if (unifiConfig.skip_tls_verify !== undefined && Boolean(unifiConfig.skip_tls_verify) !== config.skipTlsVerify) {
        logger.info(`[Bridge] Detected updated skip_tls_verify (${unifiConfig.skip_tls_verify}) in cloud settings. Updating…`);
        config.skipTlsVerify = Boolean(unifiConfig.skip_tls_verify);
        saveConfig({ SKIP_TLS_VERIFY: String(config.skipTlsVerify) });
        changed = true;
      }

      if (changed) {
        logger.info('[Bridge] Re-applying cloud credentials to UniFi client…');
        unifiClient.updateCredentials(config.unifiHost, config.unifiAccessToken, config.skipTlsVerify);
        const testOk = await unifiClient.testConnection();
        bridgeState.unifiConnected = testOk;
        if (testOk) {
          logger.info('[Bridge] ✓ Connection verified with new credentials! Running door sync…');
          await syncDoors(config.orgId, unifiClient);
          bridgeState.lastSync = new Date();
        }
      }
    },
    (err: any) => {
      logger.warn(`[Bridge] Cloud settings listener notice: ${err.message}`);
    }
  );

  bridgeState.status = 'running';
  bridgeState.errorMessage = undefined;
  logger.info('✓ Agent bridge running — listening for door commands.');

  cleanupPreviousWorker = () => {
    logger.info('[Bridge] Stopping previous bridge worker…');
    stopSettingsListener();
    stopCommandListener();
    stopVisitorSync();
    stopScheduleSync();
    stopDoorSync();
    stopHeartbeat();
    stopUpdateChecker();
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
