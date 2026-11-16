/**
 * unifi/protect.ts
 * UniFi Protect Integration API client.
 * Connects to the local UniFi OS / UNVR Protect Integration API (/proxy/protect/integration/v1)
 * using an X-API-KEY generated in UniFi Protect / UniFi OS.
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { logger } from '../logger';

export interface UnifiProtectCamera {
  id: string;
  name: string;
  modelKey?: string;
  type?: string;
  state: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING' | string;
  isRecording?: boolean;
  micVolume?: number;
  speakerSettings?: { isEnabled?: boolean };
  featureFlags?: {
    hasMic?: boolean;
    hasSpeaker?: boolean;
    [key: string]: unknown;
  };
  channels?: Array<{
    id: number;
    name?: string;
    isRtspEnabled?: boolean;
    rtspAlias?: string | null;
  }>;
  [key: string]: unknown;
}

export class UnifiProtectClient {
  private host: string;
  private apiKey: string;
  private skipTlsVerify: boolean;
  private client: AxiosInstance;

  constructor(host: string, apiKey: string, skipTlsVerify = true) {
    this.host = this.normalizeHost(host);
    this.apiKey = apiKey;
    this.skipTlsVerify = skipTlsVerify;
    this.client = this.buildClient();
  }

  private normalizeHost(host: string): string {
    const trimmed = (host || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    // Strip UniFi Access port 12445 if the user reused the Access host URL
    return trimmed.replace(/:12445$/, '');
  }

  private buildClient(): AxiosInstance {
    return axios.create({
      baseURL: `${this.host}/proxy/protect/integration/v1`,
      timeout: 15000,
      httpsAgent: new https.Agent({ rejectUnauthorized: !this.skipTlsVerify }),
      headers: {
        'X-API-KEY': this.apiKey,
        Accept: 'application/json',
      },
    });
  }

  public isConfigured(): boolean {
    return Boolean(this.host && this.apiKey);
  }

  public updateCredentials(host: string, apiKey: string, skipTlsVerify = true): void {
    this.host = this.normalizeHost(host);
    this.apiKey = apiKey;
    this.skipTlsVerify = skipTlsVerify;
    this.client = this.buildClient();
  }

  public async testConnection(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const res = await this.client.get('/cameras');
      return res.status >= 200 && res.status < 300;
    } catch (err: any) {
      logger.warn(`[Protect] Connection test failed: ${err.message}`);
      return false;
    }
  }

  public async getCameras(): Promise<UnifiProtectCamera[]> {
    if (!this.isConfigured()) return [];
    const res = await this.client.get('/cameras');
    const data = res.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }

  public async getSnapshot(cameraId: string, highQuality = false): Promise<Buffer> {
    if (!this.isConfigured()) {
      throw new Error('UniFi Protect client is not configured.');
    }
    const res = await this.client.get(`/cameras/${encodeURIComponent(cameraId)}/snapshot`, {
      params: highQuality ? { highQuality: true } : undefined,
      responseType: 'arraybuffer',
      headers: {
        'X-API-KEY': this.apiKey,
        Accept: 'image/jpeg',
      },
      timeout: 15000,
    });
    return Buffer.from(res.data);
  }

  public async getRtspStreamUrl(cameraId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await this.client.post(`/cameras/${encodeURIComponent(cameraId)}/rtsps-stream`, {
        qualities: ['medium', 'high', 'low'],
      });
      const data = res.data?.data || res.data || {};
      return data.medium || data.high || data.low || null;
    } catch {
      try {
        const res = await this.client.get(`/cameras/${encodeURIComponent(cameraId)}/rtsps-stream`);
        const data = res.data?.data || res.data || {};
        return data.medium || data.high || data.low || null;
      } catch (err: any) {
        logger.debug(`[Protect] Could not fetch RTSPS stream for ${cameraId}: ${err.message}`);
        return null;
      }
    }
  }
}
