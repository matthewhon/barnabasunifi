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

  /**
   * @param host           - Base URL of the UniFi console, e.g. https://192.168.1.1
   * @param token          - UniFi Access API bearer token
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
        logger.error(`UniFi API error [${status}] ${url}: ${body}`);
        return Promise.reject(error);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Fetch all doors registered in UniFi Access.
   */
  async getDoors(): Promise<UnifiDoor[]> {
    const response = await this.http.get<UnifiApiResponse<UnifiDoor[]>>(
      '/api/v1/developer/doors'
    );
    const data = response.data;
    if (!Array.isArray(data.data)) {
      throw new Error(
        `Unexpected response from /api/v1/developer/doors: ${JSON.stringify(data)}`
      );
    }
    return data.data;
  }

  /**
   * Get current status/details of a specific door.
   */
  async getDoorStatus(doorId: string): Promise<UnifiDoor> {
    const response = await this.http.get<UnifiApiResponse<UnifiDoor>>(
      `/api/v1/developer/doors/${encodeURIComponent(doorId)}`
    );
    return response.data.data;
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
    await this.http.put(
      `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
      payload
    );
    logger.info(
      `Door ${doorId} unlocked for ${durationMin} minute(s).`
    );
  }

  /**
   * Lock a door immediately, overriding any active unlock rule.
   * @param doorId - UniFi door ID
   */
  async lockDoor(doorId: string): Promise<void> {
    const payload: LockRulePayload = { type: 'lock_early' };
    await this.http.put(
      `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
      payload
    );
    logger.info(`Door ${doorId} locked.`);
  }

  /**
   * Verify connectivity by attempting to fetch the door list.
   * Returns true on success, false on any error.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getDoors();
      logger.info(`UniFi connection OK — host: ${this.host}`);
      return true;
    } catch (err) {
      logger.error(
        `UniFi connection test failed for ${this.host}: ${String(err)}`
      );
      return false;
    }
  }
}
