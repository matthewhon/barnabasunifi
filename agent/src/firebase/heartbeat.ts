/**
 * firebase/heartbeat.ts
 * Periodic heartbeat that reports agent liveness to Firestore.
 *
 * Writes to /agents/{agentId} on a fixed interval so the dashboard can
 * display the agent's online/offline status and last-seen time.
 * Registers SIGINT/SIGTERM handlers to cleanly mark the agent offline
 * before the process exits.
 */

import * as os from 'os';
import axios from 'axios';
import { getDb, firestoreTimestamp } from '../firebase';
import { logger } from '../logger';
import { getCacheStore } from '../storage/cacheStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = 'online' | 'offline' | 'degraded';

export interface AgentHeartbeat {
  org_id: string;
  label: string;
  status: AgentStatus;
  last_heartbeat: FirebaseFirestore.Timestamp;
  version: string;
  capabilities: string[];
  local_ip?: string;
  hostname?: string;
  platform?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_CAPABILITIES = ['unlock', 'lock', 'door_sync', 'camera_sync', 'camera_snapshot', 'camera_webrtc'] as const;

let cachedPublicIp: string | null = null;
let lastPublicIpCheckMs = 0;

async function getPublicIp(): Promise<string | null> {
  const now = Date.now();
  if (cachedPublicIp && now - lastPublicIpCheckMs < 5 * 60 * 1000) {
    return cachedPublicIp;
  }
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout: 4000 });
    const ip = res.data?.ip;
    if (typeof ip === 'string' && ip.trim()) {
      cachedPublicIp = ip.trim();
      lastPublicIpCheckMs = now;
      return cachedPublicIp;
    }
  } catch {
    // Non-fatal: keep last known public IP if offline/timeout
  }
  return cachedPublicIp;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getLocalIp(): string | null {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const alias of iface) {
        if (alias.family === 'IPv4' && !alias.internal) {
          return alias.address;
        }
      }
    }
  } catch {}
  return null;
}

async function writeHeartbeat(
  agentId: string,
  orgId: string,
  agentLabel: string,
  version: string,
  status: AgentStatus
): Promise<void> {
  const db = getDb();
  const localIp = getLocalIp();
  const publicIp = await getPublicIp();
  const cacheStore = getCacheStore();
  const payload: Record<string, any> = {
    org_id: orgId,
    label: agentLabel,
    status,
    last_heartbeat: firestoreTimestamp.now(),
    version,
    capabilities: [...AGENT_CAPABILITIES],
    ...(localIp ? { local_ip: localIp } : {}),
    ...(publicIp ? { public_ip: publicIp } : {}),
    hostname: os.hostname(),
    platform: os.platform(),
    offline_resilience: {
      cached_windows: cacheStore.getScheduleWindows().length,
      last_cache_sync: cacheStore.getCache().last_sync,
      mode: 'autonomous_lan',
    },
  };

  await db.doc(`agents/${agentId}`).set(payload, { merge: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the agent heartbeat. Writes to Firestore immediately, then on every
 * `intervalMs` milliseconds. Registers shutdown handlers to mark offline.
 *
 * @param orgId      - Firestore organization document ID
 * @param agentId    - Unique agent identifier (used as Firestore doc ID)
 * @param agentLabel - Human-readable name shown in the dashboard
 * @param version    - Agent version string (from package.json)
 * @param intervalMs - How often to write a heartbeat (default: 60 seconds)
 * @returns A cleanup function that stops the heartbeat interval.
 */
export function startHeartbeat(
  orgId: string,
  agentId: string,
  agentLabel: string,
  version: string,
  intervalMs: number
): () => void {
  logger.info(
    `[Heartbeat] Starting heartbeat for agent "${agentId}" every ${intervalMs / 1000}s`
  );

  // Write immediately on startup
  writeHeartbeat(agentId, orgId, agentLabel, version, 'online').catch((err) => {
    logger.error(`[Heartbeat] Initial heartbeat write failed: ${String(err)}`);
  });

  const handle = setInterval(() => {
    writeHeartbeat(agentId, orgId, agentLabel, version, 'online').catch((err) => {
      logger.error(`[Heartbeat] Heartbeat write failed: ${String(err)}`);
    });
  }, intervalMs);

  if (handle.unref) handle.unref();

  // ---------------------------------------------------------------------------
  // Graceful shutdown: mark agent offline before the process exits
  // ---------------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<never> => {
    logger.info(`[Heartbeat] Received ${signal} — marking agent offline and exiting.`);
    clearInterval(handle);

    try {
      await writeHeartbeat(agentId, orgId, agentLabel, version, 'offline');
      logger.info('[Heartbeat] Agent marked offline in Firestore.');
    } catch (err) {
      logger.error(`[Heartbeat] Failed to write offline status: ${String(err)}`);
    }

    process.exit(0);
  };

  const sigintHandler = () => { void shutdown('SIGINT'); };
  const sigtermHandler = () => { void shutdown('SIGTERM'); };

  process.once('SIGINT', sigintHandler);
  process.once('SIGTERM', sigtermHandler);

  // Return a cleanup function that cancels the interval and removes handlers
  return () => {
    clearInterval(handle);
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
    logger.info('[Heartbeat] Heartbeat stopped.');
  };
}
