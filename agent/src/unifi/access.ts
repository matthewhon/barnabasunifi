/**
 * unifi/access.ts
 * UniFi Access API client.
 * Wraps the UniFi Access Developer API with typed methods for door management.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiDoor {
  id: string;
  name: string;
  /** Raw lock state as returned by UniFi: 'lock' | 'unlock' | 'unknown' */
  door_lock_relay_status: 'lock' | 'unlock' | 'unknown';
  /** Door position sensor: 'open' | 'close' */
  door_position_status?: 'open' | 'close';
  type?: string;
  location_id?: string;
  full_name?: string;
  device_state?: string;
  [key: string]: unknown;
}

interface UnifiApiResponse<T> {
  data: T;
  code: string;
  msg?: string;
}

type LockRuleType = 'lock_early' | 'unlock_early' | 'custom' | 'schedule';

interface LockRulePayload {
  type: LockRuleType;
  /** Duration in minutes; only used when type === 'custom' */
  interval?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class UnifiAccessClient {
  private readonly http: AxiosInstance;
  private readonly host: string;
  private doorToHubMap: Map<string, string> = new Map();

  /**
   * @param host           - Base URL of the UniFi console, e.g. https://192.168.1.1
   * @param token          - UniFi Access API token
   * @param skipTlsVerify  - When true, disables TLS certificate validation
   *                         (needed for self-signed certs on UniFi consoles)
   */
  constructor(host: string, token: string, skipTlsVerify = false) {
    this.host = host.replace(/\/$/, '');

    const httpsAgent = new https.Agent({
      rejectUnauthorized: !skipTlsVerify,
    });

    this.http = axios.create({
      baseURL: this.host,
      httpsAgent,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-KEY': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15_000,
    });

    // Log outgoing requests at debug level
    this.http.interceptors.request.use((config) => {
      logger.debug(`UniFi → ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Log responses and surface API-level errors
    this.http.interceptors.response.use(
      (response) => {
        logger.debug(`UniFi ← ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        const status = error.response?.status ?? 'N/A';
        const url = error.config?.url ?? 'unknown';
        const body = error.response?.data
          ? JSON.stringify(error.response.data)
          : error.message;
        logger.debug(`UniFi API error [${status}] ${url}: ${body}`);
        return Promise.reject(error);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Fetch all doors registered in UniFi Access.
   * Checks v1 Developer API first, falls back to UniFi OS Access v2 API.
   */
  async getDoors(): Promise<UnifiDoor[]> {
    try {
      const response = await this.http.get<UnifiApiResponse<UnifiDoor[]>>(
        '/api/v1/developer/doors'
      );
      if (Array.isArray(response.data?.data)) {
        return response.data.data;
      }
    } catch {
      // Fall through to v2 API
    }

    // UniFi Access v2 API
    const response = await this.http.get<{
      code: number;
      data: Array<{
        unique_id: string;
        name: string;
        alias?: string;
        device_type?: string;
        device_state?: string;
        state?: string;
        door_lock_relay_status?: 'lock' | 'unlock' | 'unknown';
        door_position_status?: 'open' | 'close';
        door?: {
          unique_id: string;
          name: string;
          full_name?: string;
          up_id?: string;
        };
      }>;
    }>('/proxy/access/api/v2/devices');

    const devices = response.data?.data || [];
    const doorMap = new Map<string, UnifiDoor>();

    for (const d of devices) {
      if (d.door && d.door.unique_id) {
        const doorId = d.door.unique_id;
        const deviceType = (d.device_type || '').toLowerCase();
        const isHub = deviceType.includes('hub') || deviceType.includes('uah');

        const existing = doorMap.get(doorId);
        if (!existing || isHub) {
          this.doorToHubMap.set(doorId, d.unique_id);
          doorMap.set(doorId, {
            id: doorId,
            name: d.door.name || d.alias || d.name,
            door_lock_relay_status: d.door_lock_relay_status || 'lock',
            door_position_status: d.door_position_status || 'close',
            type: d.device_type,
            location_id: d.door.up_id || '',
            full_name: d.door.full_name || d.door.name,
            device_state: d.device_state || d.state || 'connected',
          });
        }
      }
    }

    return Array.from(doorMap.values());
  }

  /**
   * Get current status/details of a specific door.
   */
  async getDoorStatus(doorId: string): Promise<UnifiDoor> {
    const doors = await this.getDoors();
    const found = doors.find((d) => d.id === doorId);
    if (!found) {
      throw new Error(`Door ${doorId} not found in UniFi Access.`);
    }
    return found;
  }

  /**
   * Unlock a door for the specified duration.
   * @param doorId      - UniFi door ID
   * @param durationMin - How long to hold the door unlocked, in minutes
   */
  async unlockDoor(doorId: string, durationMin: number): Promise<void> {
    const payload: LockRulePayload = {
      type: 'custom',
      interval: durationMin,
    };

    try {
      await this.http.put(
        `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
        payload
      );
      logger.info(`Door ${doorId} unlocked for ${durationMin} minute(s).`);
      return;
    } catch {
      // Fall through to v2 API
    }

    const hubId = this.doorToHubMap.get(doorId) || doorId;
    await this.http.put(
      `/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`,
      payload
    );
    logger.info(`Door ${doorId} (Hub: ${hubId}) unlocked for ${durationMin} minute(s).`);
  }

  /**
   * Lock a door immediately, overriding any active unlock rule.
   * @param doorId - UniFi door ID
   */
  async lockDoor(doorId: string): Promise<void> {
    try {
      const payload: LockRulePayload = { type: 'lock_early' };
      await this.http.put(
        `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
        payload
      );
      logger.info(`Door ${doorId} locked.`);
      return;
    } catch {
      // Fall through to v2 API
    }

    const hubId = this.doorToHubMap.get(doorId) || doorId;
    await this.http.put(
      `/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`,
      { type: 'schedule' }
    );
    logger.info(`Door ${doorId} (Hub: ${hubId}) locked.`);
  }

  /**
   * Verify connectivity by attempting to fetch the door list.
   * Returns true on success, false on any error.
   */
  async testConnection(): Promise<boolean> {
    try {
      const doors = await this.getDoors();
      logger.info(`UniFi connection OK — host: ${this.host} (${doors.length} doors found)`);
      return true;
    } catch (err) {
      logger.error(
        `UniFi connection test failed for ${this.host}: ${String(err)}`
      );
      return false;
    }
  }
}
