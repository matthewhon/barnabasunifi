/**
 * unifi/protect.ts
 * UniFi Protect Integration API client.
 * Connects to the local UniFi OS / UNVR Protect Integration API (/proxy/protect/integration/v1)
 * using an X-API-KEY generated in UniFi Protect / UniFi OS.
 */

import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import * as crypto from 'crypto';
import { logger } from '../logger';

export interface ProtectEventMessage {
  type?: string;
  item?: {
    id?: string;
    modelKey?: string;
    type?: string; // e.g. 'motion', 'smartDetectZone', 'ring'
    device?: string; // camera ID
    start?: number;
    smartDetectTypes?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

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

  /**
   * Subscribe to real-time UniFi Protect Integration WebSocket events
   * (/proxy/protect/integration/v1/subscribe/events) using zero-dependency RFC 6455.
   */
  public subscribeToEvents(onEvent: (evt: ProtectEventMessage) => void): () => void {
    let stopped = false;
    let currentSocket: any = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      if (stopped || !this.isConfigured()) return;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(this.host);
      } catch {
        return;
      }

      const wsKey = crypto.randomBytes(16).toString('base64');
      const req = https.request({
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : 443,
        path: '/proxy/protect/integration/v1/subscribe/events',
        method: 'GET',
        rejectUnauthorized: !this.skipTlsVerify,
        headers: {
          'X-API-KEY': this.apiKey,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': wsKey,
        },
      });

      req.on('upgrade', (_res, socket) => {
        currentSocket = socket;
        let buffer = Buffer.alloc(0);

        socket.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 2) {
            const firstByte = buffer[0];
            const secondByte = buffer[1];
            const opcode = firstByte & 0x0f;
            const masked = (secondByte & 0x80) !== 0;
            let payloadLen = secondByte & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
              if (buffer.length < 4) return;
              payloadLen = buffer.readUInt16BE(2);
              offset = 4;
            } else if (payloadLen === 127) {
              if (buffer.length < 10) return;
              payloadLen = Number(buffer.readBigUInt64BE(2));
              offset = 10;
            }

            if (masked) offset += 4;
            if (buffer.length < offset + payloadLen) return;

            let payload = buffer.subarray(offset, offset + payloadLen);
            if (masked) {
              const mask = buffer.subarray(offset - 4, offset);
              const unmasked = Buffer.alloc(payloadLen);
              for (let i = 0; i < payloadLen; i++) {
                unmasked[i] = payload[i] ^ mask[i % 4];
              }
              payload = unmasked;
            }

            buffer = buffer.subarray(offset + payloadLen);

            if (opcode === 0x8) {
              socket.end();
              return;
            }
            if (opcode === 0x9) {
              // Ping -> Pong
              const pong = Buffer.alloc(2 + payload.length);
              pong[0] = 0x8a;
              pong[1] = payload.length;
              payload.copy(pong, 2);
              socket.write(pong);
              continue;
            }
            if (opcode === 0x1) {
              const text = payload.toString('utf8');
              for (const line of text.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  onEvent(JSON.parse(trimmed) as ProtectEventMessage);
                } catch {
                  // Ignore non-JSON heartbeat lines
                }
              }
            }
          }
        });

        socket.on('close', () => {
          currentSocket = null;
          if (!stopped) {
            reconnectTimer = setTimeout(connect, 10_000);
          }
        });

        socket.on('error', () => {
          socket.destroy();
        });
      });

      req.on('response', (res) => {
        logger.debug(`[Protect] Event WebSocket returned HTTP ${res.statusCode}`);
        res.resume();
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 30_000);
        }
      });

      req.on('error', () => {
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 15_000);
        }
      });

      req.end();
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (currentSocket) {
        try {
          currentSocket.destroy();
        } catch {}
        currentSocket = null;
      }
    };
  }
}

export interface ManagedProtectConsole {
  id: string;
  label: string;
  client: UnifiProtectClient;
}

export class ProtectManager {
  private consoles: ManagedProtectConsole[] = [];

  public isConfigured(): boolean {
    return this.consoles.some((c) => c.client.isConfigured());
  }

  public getConsoles(): ManagedProtectConsole[] {
    return this.consoles.filter((c) => c.client.isConfigured());
  }

  public clear(): void {
    this.consoles = [];
  }

  public setConsoles(
    entries: Array<{ id: string; label: string; host: string; apiKey: string; skipTlsVerify?: boolean }>
  ): void {
    this.consoles = entries
      .filter((e) => e.host && e.apiKey)
      .map((e) => ({
        id: e.id,
        label: e.label || e.id,
        client: new UnifiProtectClient(e.host, e.apiKey, e.skipTlsVerify ?? true),
      }));
  }

  public getClientForConsole(consoleId?: string | null): UnifiProtectClient | null {
    const active = this.getConsoles();
    if (active.length === 0) return null;
    if (consoleId) {
      const found = active.find((c) => c.id === consoleId);
      if (found) return found.client;
    }
    return active[0].client;
  }
}
