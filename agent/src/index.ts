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
import { syncAccessLogs, startAccessLogSyncInterval } from './firebase/accessLogSync';
import { syncAccessPolicies, startPolicySyncInterval } from './firebase/userSync';
import { startCommandListener } from './firebase/commandListener';
import { startUpdateChecker } from './firebase/updateChecker';
import { startWebServer, AgentBridgeState } from './web/server';
import { autoDiscoverUnifiConsole } from './web/scanner';
import { getCacheStore } from './storage/cacheStore';
import { LocalScheduler } from './scheduler/localScheduler';
import { startScheduleWindowSync } from './firebase/scheduleWindowSync';
import { reconcileOfflineActions } from './firebase/reconciliation';
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
  offlineMode: false,
  cachedWindowsCount: 0,
  pendingOfflineActionsCount: 0,
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
      const { orgId, customToken, projectId, unifiHost, unifiAccessToken, unifiApiKey, skipTlsVerify } = response.data;
      logger.info(`[AutoRegister] ✓ Paired successfully with Organization: ${orgId}`);

      saveConfig({
        ORG_ID: orgId,
        FIREBASE_PROJECT_ID: projectId || 'barnabasunfi',
        AGENT_AUTH_TOKEN: customToken,
        ...(unifiHost ? { UNIFI_HOST: unifiHost } : {}),
        ...(unifiAccessToken ? { UNIFI_ACCESS_TOKEN: unifiAccessToken } : {}),
        ...(unifiApiKey ? { UNIFI_API_KEY: unifiApiKey } : {}),
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

  const cacheStore = getCacheStore();
  cacheStore.setOrgId(config.orgId);
  bridgeState.cachedWindowsCount = cacheStore.getScheduleWindows().length;
  bridgeState.pendingOfflineActionsCount = cacheStore.getPendingOfflineActions().length;

  // 1. Initialize UniFi Access client over LAN first
  const unifiClient = new UnifiAccessClient(
    config.unifiHost,
    config.unifiAccessToken,
    config.skipTlsVerify,
    config.unifiApiKey
  );

  // 2. Test UniFi connectivity on LAN with auto-discovery fallback
  logger.info('Testing UniFi Access connection on LAN…');
  try {
    let connected = await unifiClient.testConnection();
    if (!connected) {
      logger.warn(`[Bridge] Could not connect to configured host (${config.unifiHost}). Scanning LAN for active console…`);
      const discovered = await autoDiscoverUnifiConsole(config.unifiAccessToken);
      if (discovered && discovered !== config.unifiHost) {
        logger.info(`[Bridge] Discovered active console on LAN at: ${discovered}. Connecting…`);
        config.unifiHost = discovered;
        saveConfig({ UNIFI_HOST: discovered });
        unifiClient.updateCredentials(discovered, config.unifiAccessToken, config.skipTlsVerify, config.unifiApiKey);
        connected = await unifiClient.testConnection();
      }
    }

    if (!connected) {
      bridgeState.status = 'error';
      bridgeState.unifiConnected = false;
      bridgeState.errorMessage = 'Could not connect to UniFi Access API on LAN. Check host & token.';
      logger.error(
        '[Bridge] Could not connect to UniFi Access API. ' +
          'Check UNIFI_HOST, UNIFI_ACCESS_TOKEN, and network reachability.'
      );
      return;
    }
    bridgeState.unifiConnected = true;

    // Update door count from local UniFi console or cached doors
    try {
      const liveDoors = await unifiClient.getDoors();
      bridgeState.doorCount = liveDoors.length;
    } catch {
      bridgeState.doorCount = cacheStore.getDoors().length;
    }
  } catch (err: any) {
    bridgeState.status = 'error';
    bridgeState.unifiConnected = false;
    bridgeState.errorMessage = `UniFi connection error: ${err.message}`;
    logger.error(`[Bridge] UniFi connection error: ${err.message}`);
    return;
  }

  // 3. Start Local Autonomous Scheduler
  // Runs continuously regardless of online/offline status, triggering LAN unlocks/locks
  const localScheduler = new LocalScheduler(
    config.orgId,
    config.agentId,
    unifiClient,
    () => bridgeState.firebaseConnected
  );
  localScheduler.start(10000);
  bridgeState.getNextUpcomingActions = () => localScheduler.getNextUpcomingActions();

  // 4. Manage Firebase Online Workers & Connection State
  let stopOnlineWorkers: (() => void) | null = null;
  let reconnectInterval: NodeJS.Timeout | null = null;

  async function startOnlineWorkers(): Promise<void> {
    if (stopOnlineWorkers) {
      try {
        stopOnlineWorkers();
      } catch {}
      stopOnlineWorkers = null;
    }

    const db = getDb();
    bridgeState.firebaseConnected = true;
    bridgeState.offlineMode = false;
    bridgeState.status = 'running';
    bridgeState.errorMessage = undefined;

    // Reconcile any actions executed while offline
    try {
      const reconciled = await reconcileOfflineActions(config.orgId, config.agentId);
      bridgeState.pendingOfflineActionsCount = cacheStore.getPendingOfflineActions().length;
      if (reconciled > 0) {
        logger.info(`[Bridge] Reconciled ${reconciled} offline action(s) to Firestore.`);
      }
    } catch (recErr) {
      logger.warn(`[Bridge] Offline reconciliation notice: ${String(recErr)}`);
    }

    // Register / update agent document in Firestore
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
          offline_resilience: {
            cached_windows: cacheStore.getScheduleWindows().length,
            last_cache_sync: cacheStore.getCache().last_sync,
            mode: 'autonomous_lan',
          },
        },
        { merge: true }
      );
      logger.info(`Agent document registered: agents/${config.agentId}`);
    } catch (err) {
      logger.error(`Failed to register agent document: ${String(err)}`);
    }

    // Proactive schedule window sync (14-day lookahead)
    const stopWindowSync = startScheduleWindowSync(config.orgId, (count) => {
      bridgeState.cachedWindowsCount = count;
      bridgeState.pendingOfflineActionsCount = cacheStore.getPendingOfflineActions().length;
    });

    // Start heartbeat
    const stopHeartbeat = startHeartbeat(
      config.orgId,
      config.agentId,
      config.agentLabel,
      config.version,
      config.heartbeatIntervalMs
    );

    // Start OTA update checker
    const stopUpdateChecker = startUpdateChecker(
      config.agentId,
      config.orgId,
      60 * 1000,
      bridgeState.onRestartRequest
    );

    // Initial door sync & recurring
    try {
      const doors = await syncDoors(config.orgId, unifiClient);
      bridgeState.doorCount = doors.length;
      bridgeState.lastSync = new Date();
    } catch (err: any) {
      logger.error(`[DoorSync] Initial sync error: ${err.message}`);
    }
    const stopDoorSync = startDoorSyncInterval(
      config.orgId,
      unifiClient,
      config.doorSyncIntervalMs
    );

    // Initial schedule sync & recurring
    try {
      const schedules = await syncSchedules(config.orgId, unifiClient);
      logger.info(`[ScheduleSync] Initial sync completed (${schedules.length} schedules found).`);
    } catch (err: any) {
      logger.error(`[ScheduleSync] Initial sync error: ${err.message}`);
    }
    const stopScheduleSync = startScheduleSyncInterval(config.orgId, unifiClient, 60 * 1000);

    // Initial access policy sync & recurring
    try {
      const policies = await syncAccessPolicies(config.orgId, unifiClient);
      logger.info(`[PolicySync] Initial sync completed (${policies.length} policies found).`);
    } catch (err: any) {
      logger.error(`[PolicySync] Initial sync error: ${err.message}`);
    }
    const stopPolicySync = startPolicySyncInterval(config.orgId, unifiClient, 60 * 1000);

    // Initial visitor sync & recurring
    try {
      const visitors = await syncVisitors(config.orgId, unifiClient);
      logger.info(`[VisitorSync] Initial sync completed (${visitors.length} visitors found).`);
    } catch (err: any) {
      logger.error(`[VisitorSync] Initial sync error: ${err.message}`);
    }
    const stopVisitorSync = startVisitorSyncInterval(config.orgId, unifiClient, 60 * 1000);

    // Initial access log sync & recurring
    try {
      const logs = await syncAccessLogs(config.orgId, unifiClient);
      logger.info(`[AccessLogSync] Initial sync completed (${logs.length} access logs found).`);
    } catch (err: any) {
      logger.error(`[AccessLogSync] Initial sync error: ${err.message}`);
    }
    const stopAccessLogSync = startAccessLogSyncInterval(config.orgId, unifiClient, 25 * 1000);

    // Start Firestore command listener
    const stopCommandListener = startCommandListener(
      config.orgId,
      config.agentId,
      unifiClient,
      (cmd) => {
        logger.debug(
          `[Main] Command callback — id: ${cmd.id} action: ${cmd.action} door: ${cmd.door_id}`
        );
      },
      bridgeState.onRestartRequest
    );

    // Cloud settings listener
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

        const incomingApiKey = unifiConfig.api_key || unifiConfig.developer_api_key || '';
        if (incomingApiKey && incomingApiKey !== config.unifiApiKey) {
          logger.info('[Bridge] Detected updated UniFi Developer API key in cloud settings. Updating…');
          config.unifiApiKey = incomingApiKey;
          saveConfig({ UNIFI_API_KEY: incomingApiKey });
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
          unifiClient.updateCredentials(config.unifiHost, config.unifiAccessToken, config.skipTlsVerify, config.unifiApiKey);
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
        if (err?.code === 'unavailable' || err?.message?.includes('offline') || err?.message?.includes('network')) {
          bridgeState.firebaseConnected = false;
          bridgeState.offlineMode = true;
        }
      }
    );

    stopOnlineWorkers = () => {
      stopSettingsListener();
      stopCommandListener();
      stopAccessLogSync();
      stopVisitorSync();
      stopPolicySync();
      stopScheduleSync();
      stopDoorSync();
      stopHeartbeat();
      stopUpdateChecker();
      stopWindowSync();
    };

    logger.info('✓ Agent cloud bridge running — listening for cloud commands and syncs.');
  }

  // 5. Initialize Firebase or enter Autonomous Offline Mode
  try {
    await initializeFirebase(config.firebaseServiceAccountPath, config.firebaseProjectId);
    bridgeState.firebaseConnected = true;
    bridgeState.offlineMode = false;
    await startOnlineWorkers();
  } catch (err: any) {
    bridgeState.firebaseConnected = false;
    bridgeState.offlineMode = true;
    bridgeState.status = 'running';
    bridgeState.errorMessage = undefined;

    logger.warn(`[Bridge] ⚠️ Firebase initialization failed on startup: ${err.message}`);
    logger.warn(
      `[Bridge] 🛡️ Entered Autonomous Offline Mode: ${cacheStore.getScheduleWindows().length} schedule window(s) cached locally. ` +
        `LocalScheduler will continue executing scheduled unlocks and locks over LAN!`
    );

    // Launch background reconnection retry loop
    reconnectInterval = setInterval(async () => {
      if (bridgeState.firebaseConnected) return;
      try {
        await initializeFirebase(config.firebaseServiceAccountPath, config.firebaseProjectId);
        logger.info('[Bridge] ✓ Firebase connection established! Transitioning to online mode…');
        if (reconnectInterval) {
          clearInterval(reconnectInterval);
          reconnectInterval = null;
        }
        await startOnlineWorkers();
      } catch {
        // Still offline, will retry on next interval
      }
    }, 20000);
    if (reconnectInterval.unref) reconnectInterval.unref();
  }

  bridgeState.onSyncDoors = async () => {
    logger.info('[Bridge] Executing on-demand door discovery sync…');
    const doors = await syncDoors(config.orgId, unifiClient);
    bridgeState.doorCount = doors.length;
    bridgeState.lastSync = new Date();
    return doors.length;
  };

  cleanupPreviousWorker = () => {
    logger.info('[Bridge] Stopping previous bridge worker…');
    bridgeState.onSyncDoors = undefined;
    bridgeState.getNextUpcomingActions = undefined;
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
    localScheduler.stop();
    if (stopOnlineWorkers) {
      stopOnlineWorkers();
      stopOnlineWorkers = null;
    }
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
