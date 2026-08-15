/**
 * config.ts
 * Loads and validates all required environment variables.
 * Throws descriptive errors on missing or invalid values.
 */

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
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  return value.trim();
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  const parsed = parseInt(value.trim(), 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got: "${value}"`
    );
  }
  return parsed;
}

function optionalBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value || value.trim() === '') return defaultValue;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  throw new Error(
    `Environment variable ${name} must be a boolean (true/false), got: "${value}"`
  );
}

export function loadConfig(): AgentConfig {
  const config: AgentConfig = {
    unifiHost: requireEnv('UNIFI_HOST').replace(/\/$/, ''), // strip trailing slash
    unifiAccessToken: requireEnv('UNIFI_ACCESS_TOKEN'),
    firebaseServiceAccountPath: requireEnv('FIREBASE_SERVICE_ACCOUNT_PATH'),
    firebaseProjectId: requireEnv('FIREBASE_PROJECT_ID'),
    orgId: requireEnv('ORG_ID'),
    agentId: requireEnv('AGENT_ID'),
    agentLabel: optionalEnv('AGENT_LABEL', 'Unnamed Agent'),
    heartbeatIntervalMs: optionalIntEnv('HEARTBEAT_INTERVAL_MS', 60_000),
    doorSyncIntervalMs: optionalIntEnv('DOOR_SYNC_INTERVAL_MS', 300_000),
    skipTlsVerify: optionalBoolEnv('SKIP_TLS_VERIFY', false),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    version: optionalEnv('npm_package_version', '1.0.0'),
  };

  // Validate UNIFI_HOST is a valid URL
  try {
    new URL(config.unifiHost);
  } catch {
    throw new Error(
      `UNIFI_HOST must be a valid URL (e.g. https://192.168.1.1), got: "${config.unifiHost}"`
    );
  }

  return config;
}
