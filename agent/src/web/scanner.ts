/**
 * scanner.ts
 * Scans local subnets for active UniFi Consoles (UDM, Cloud Key, etc.).
 */

import * as https from 'https';
import * as os from 'os';
import axios from 'axios';

export interface DiscoveredConsole {
  ip: string;
  url: string;
  isConfirmedUnifi: boolean;
  statusText: string;
  responseTimeMs: number;
}

/**
 * Get candidate subnets based on local interfaces, plus common LAN defaults.
 */
export function getCandidateSubnets(): string[] {
  const subnets = new Set<string>();
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        if (parts.length === 4) {
          // If not a docker-internal 172.x subnet, add as high priority
          if (parts[0] === '192' && parts[1] === '168') {
            subnets.add(`192.168.${parts[2]}`);
          } else if (parts[0] === '10') {
            subnets.add(`10.${parts[1]}.${parts[2]}`);
          }
        }
      }
    }
  }

  // Common church / small business subnets as defaults
  subnets.add('192.168.1');
  subnets.add('192.168.0');
  subnets.add('192.168.2');
  subnets.add('10.0.0');
  subnets.add('10.0.1');

  return Array.from(subnets);
}

/**
 * Probe an individual IP on port 443 with a short timeout to see if it is a UniFi console.
 */
async function probeHost(ip: string, timeoutMs = 800): Promise<DiscoveredConsole | null> {
  const start = Date.now();
  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    timeout: timeoutMs,
  });

  try {
    const url = `https://${ip}`;
    const res = await axios.get(`${url}/api/v1/developer/doors`, {
      httpsAgent,
      timeout: timeoutMs,
      validateStatus: () => true, // Don't throw on 401 or 403
    });

    const elapsed = Date.now() - start;
    // UniFi Access developer API returns 401 Unauthorized with JSON or specific headers
    if (res.status === 401 || res.status === 200 || res.status === 403) {
      const dataStr = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data || '');
      const serverHeader = String(res.headers['server'] || '').toLowerCase();
      const isUnifi =
        dataStr.includes('code') ||
        dataStr.includes('UNAUTHORIZED') ||
        dataStr.includes('access') ||
        serverHeader.includes('nginx') ||
        res.headers['x-accel-version'] !== undefined;

      return {
        ip,
        url,
        isConfirmedUnifi: isUnifi,
        statusText: `Responded (HTTP ${res.status}) in ${elapsed}ms`,
        responseTimeMs: elapsed,
      };
    }
  } catch (err: any) {
    // Check if it failed with TLS cert error or HTTP connection
    if (err.code === 'ECONNRESET' || err.response?.status === 401) {
      return {
        ip,
        url: `https://${ip}`,
        isConfirmedUnifi: true,
        statusText: `Active HTTPS host`,
        responseTimeMs: Date.now() - start,
      };
    }
  }

  return null;
}

/**
 * Scan a /24 subnet prefix (e.g. "192.168.1") concurrently with concurrency limit.
 */
export async function scanSubnet(
  subnetPrefix: string,
  onProgress?: (scanned: number, total: number) => void
): Promise<DiscoveredConsole[]> {
  const cleanPrefix = subnetPrefix.replace(/\.0$/, '').replace(/\.$/, '');
  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    ips.push(`${cleanPrefix}.${i}`);
  }

  const results: DiscoveredConsole[] = [];
  const concurrency = 30;
  let scanned = 0;

  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (ip) => {
        const found = await probeHost(ip);
        scanned++;
        if (onProgress) onProgress(scanned, ips.length);
        return found;
      })
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  // Sort confirmed UniFi first, then by response time
  return results.sort((a, b) => {
    if (a.isConfirmedUnifi && !b.isConfirmedUnifi) return -1;
    if (!a.isConfirmedUnifi && b.isConfirmedUnifi) return 1;
    return a.responseTimeMs - b.responseTimeMs;
  });
}

/**
 * Automatically scan candidate subnets to find the UniFi Access console on LAN.
 * If token is provided, tests the token against candidate consoles to ensure authentication.
 */
export async function autoDiscoverUnifiConsole(token?: string): Promise<string | null> {
  const candidateSubnets = getCandidateSubnets();
  for (const subnet of candidateSubnets) {
    const consoles = await scanSubnet(subnet);
    if (consoles.length > 0) {
      if (token) {
        for (const candidate of consoles) {
          try {
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });
            const res = await axios.get(`${candidate.url}/api/v1/developer/doors`, {
              headers: { Authorization: `Bearer ${token}` },
              httpsAgent,
              timeout: 1500,
              validateStatus: () => true,
            });
            if (res.status === 200) {
              return candidate.url;
            }
          } catch {
            // continue checking
          }
        }
      }
      const confirmed = consoles.find((c) => c.isConfirmedUnifi) || consoles[0];
      if (confirmed) {
        return confirmed.url;
      }
    }
  }
  return null;
}
