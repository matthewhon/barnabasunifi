/**
 * config.ts
 * Loads and validates all required environment variables.
 * Allows safe inspection of configuration status and dynamic updating.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface AgentConfig {
  unifiHost: string;
  unifiAccessToken: string;
  firebaseServiceAccountPath: string;
  firebaseProjectId: string;
  orgId: string;
  agentId: string;
  agentLabel: string;
  heartbeatIntervalMs: number;
  doorSyncIntervalMs: number;
  skipTlsVerify: boolean;
  logLevel: string;
  version: string;
  port: number;
  agentAuthToken?: string;
  connectionToken?: string;
}

export interface ConfigStatus {
  isConfigured: boolean;
  missing: string[];
  config: AgentConfig | null;
  serviceAccountFound: boolean;
  canAutoRegister: boolean;
}

const ENV_PATH = path.resolve(process.cwd(), '.env');

/**
 * Reload .env from disk into process.env.
 */
export function reloadEnv(): void {
  if (fs.existsSync(ENV_PATH)) {
    try {
      const envConfig = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf-8'));
      for (const k in envConfig) {
        process.env[k] = envConfig[k];
      }
    } catch {
      // ignore
    }
  }
}

function getEnv(name: string, defaultValue = ''): string {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  return value.trim();
}

function getIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value.trim(), 10);
  return isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

function getBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  return defaultValue;
}

/**
 * Search for valid service-account.json across common locations.
 */
export function findServiceAccountPath(preferredPath?: string): string | null {
  const candidates = [
    preferredPath,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    path.resolve(process.cwd(), 'service-account.json'),
    path.resolve(process.cwd(), 'config/service-account.json'),
    '/app/service-account.json',
    '/app/config/service-account.json',
    './service-account.json',
  ].filter(Boolean) as string[];

  for (const cand of candidates) {
    try {
      const resolved = path.resolve(cand);
      if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
        const content = fs.readFileSync(resolved, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.project_id && parsed.private_key) {
          return resolved;
        }
      }
    } catch {
      // continue checking next candidate
    }
  }
  return null;
}

/**
 * Check if service account file exists at configured path or common locations.
 */
export function isServiceAccountPresent(filePath?: string): boolean {
  return findServiceAccountPath(filePath) !== null;
}

/**
 * Non-throwing check for configuration status.
 */
export function getConfigurationStatus(): ConfigStatus {
  reloadEnv();

  const missing: string[] = [];

  const unifiHost = getEnv('UNIFI_HOST');
  if (!unifiHost) {
    missing.push('UNIFI_HOST');
  } else {
    try {
      new URL(unifiHost);
    } catch {
      missing.push('UNIFI_HOST (must be valid URL e.g. https://192.168.1.1)');
    }
  }

  const unifiAccessToken = getEnv('UNIFI_ACCESS_TOKEN');
  if (!unifiAccessToken) missing.push('UNIFI_ACCESS_TOKEN');

  const firebaseProjectId = getEnv('FIREBASE_PROJECT_ID', 'barnabasunfi');
  const orgId = getEnv('ORG_ID');
  if (!orgId) missing.push('ORG_ID');

  const agentId = getEnv('AGENT_ID', 'agent-main-campus');
  const resolvedSaPath = findServiceAccountPath(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  const agentAuthToken = getEnv('AGENT_AUTH_TOKEN');
  const connectionToken = getEnv('CONNECTION_TOKEN');

  const hasAuth = Boolean(resolvedSaPath || agentAuthToken || connectionToken);
  if (!hasAuth) {
    missing.push('Authentication (Connection Token or service-account.json)');
  }

  const canAutoRegister = Boolean(connectionToken && (!agentAuthToken || !unifiAccessToken));

  const config: AgentConfig = {
    unifiHost: unifiHost.replace(/\/$/, ''),
    unifiAccessToken,
    firebaseServiceAccountPath: resolvedSaPath || './service-account.json',
    firebaseProjectId,
    orgId,
    agentId,
    agentLabel: getEnv('AGENT_LABEL', 'Main Campus Agent'),
    heartbeatIntervalMs: getIntEnv('HEARTBEAT_INTERVAL_MS', 60_000),
    doorSyncIntervalMs: getIntEnv('DOOR_SYNC_INTERVAL_MS', 10_000),
    skipTlsVerify: getBoolEnv('SKIP_TLS_VERIFY', true),
    logLevel: getEnv('LOG_LEVEL', 'info'),
    port: getIntEnv('PORT', 8080),
    version: (() => {
      if (process.env.AGENT_VERSION) return process.env.AGENT_VERSION;
      if (process.env.npm_package_version) return process.env.npm_package_version;
      try {
        const p = path.resolve(__dirname, '../package.json');
        if (fs.existsSync(p)) {
          const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (pkg.version) return pkg.version;
        }
      } catch {}
      return '1.1.1';
    })(),
    agentAuthToken: agentAuthToken || undefined,
    connectionToken: connectionToken || undefined,
  };

  return {
    isConfigured: missing.length === 0,
    missing,
    config: missing.length === 0 ? config : null,
    serviceAccountFound: Boolean(resolvedSaPath),
    canAutoRegister,
  };
}

/**
 * Save configuration to memory and persist to .env file if writable.
 */
export function saveConfig(updates: Record<string, string>): void {
  let currentEnv: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    try {
      currentEnv = dotenv.parse(fs.readFileSync(ENV_PATH, 'utf-8'));
    } catch {
      // ignore
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== null) {
      currentEnv[key] = value.trim();
      process.env[key] = value.trim();
    }
  }

  try {
    const lines = Object.entries(currentEnv).map(([k, v]) => `${k}=${v}`);
    fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
  } catch {
    // In read-only environments, process.env is still updated in memory
  }
}
