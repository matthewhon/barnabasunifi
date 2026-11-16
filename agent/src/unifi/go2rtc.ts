/**
 * unifi/go2rtc.ts
 * Manages an optional embedded go2rtc binary for low-latency LAN WebRTC / MSE
 * camera streaming without transcoding.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import axios from 'axios';
import { logger } from '../logger';
import { UnifiProtectClient, UnifiProtectCamera } from './protect';

let go2rtcProc: ChildProcess | null = null;
const GO2RTC_PORT = 1984;

function findGo2RtcBinary(): string | null {
  const candidates = ['/usr/local/bin/go2rtc', '/app/go2rtc', 'go2rtc'];
  for (const cand of candidates) {
    if (cand === 'go2rtc' || fs.existsSync(cand)) {
      return cand;
    }
  }
  return null;
}

export function startGo2Rtc(): boolean {
  if (go2rtcProc) return true;
  const bin = findGo2RtcBinary();
  if (!bin) {
    logger.info('[go2rtc] Binary not found — running in snapshot-only mode.');
    return false;
  }

  try {
    go2rtcProc = spawn(bin, ['-config', `{api: {listen: ":${GO2RTC_PORT}", origin: "*"}}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    go2rtcProc.on('exit', (code) => {
      logger.warn(`[go2rtc] Process exited with code ${code}`);
      go2rtcProc = null;
    });
    logger.info(`[go2rtc] Started local WebRTC/MSE relay on port ${GO2RTC_PORT}`);
    return true;
  } catch (err: any) {
    logger.warn(`[go2rtc] Failed to start: ${err.message}`);
    return false;
  }
}

export function stopGo2Rtc(): void {
  if (go2rtcProc) {
    go2rtcProc.kill('SIGTERM');
    go2rtcProc = null;
  }
}

export async function syncGo2RtcStreams(
  cameras: UnifiProtectCamera[],
  protectClient: UnifiProtectClient
): Promise<void> {
  if (!go2rtcProc) return;

  for (const cam of cameras) {
    if (cam.state !== 'CONNECTED') continue;
    const rtspUrl = await protectClient.getRtspStreamUrl(cam.id);
    if (!rtspUrl) continue;
    try {
      await axios.put(
        `http://127.0.0.1:${GO2RTC_PORT}/api/streams`,
        null,
        {
          params: { name: cam.id, src: rtspUrl },
          timeout: 5000,
        }
      );
    } catch (err: any) {
      logger.debug(`[go2rtc] Failed to register stream ${cam.id}: ${err.message}`);
    }
  }
}
