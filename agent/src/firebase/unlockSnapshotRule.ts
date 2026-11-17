/**
 * firebase/unlockSnapshotRule.ts
 * Evaluates per-door unlock photo capture rules (PCO Services/Groups windows
 * and custom day/time ranges) and captures event snapshots from UniFi Protect.
 */

import { getDb, uploadCameraSnapshot } from '../firebase';
import { ProtectManager } from '../unifi/protect';
import { AccessLogEntry, DayOfWeek } from '../unifi/access';
import { logger } from '../logger';

export type UnlockSnapshotRuleMode =
  | 'off'
  | 'always'
  | 'outside_pco_windows'
  | 'during_pco_windows'
  | 'custom_schedule';

export interface UnlockSnapshotTimeRange {
  days: DayOfWeek[];
  start_time: string;
  end_time: string;
}

export interface UnlockSnapshotConfig {
  enabled: boolean;
  mode: UnlockSnapshotRuleMode;
  camera_id?: string | null;
  pco_service_type_ids?: string[];
  pco_group_ids?: string[];
  pco_buffer_min?: number;
  custom_ranges?: UnlockSnapshotTimeRange[];
  skip_during_pco_windows?: boolean;
  capture_on_denied?: boolean;
}

export interface DoorSnapshotDoc {
  id: string;
  primary_camera_id?: string | null;
  camera_ids?: string[];
  unlock_snapshot_config?: UnlockSnapshotConfig | null;
}

export interface ScheduleWindowSnapshotDoc {
  id: string;
  status?: string;
  source_type?: 'service' | 'group' | string;
  pco_service_type_id?: string;
  pco_group_id?: string;
  unlock_at: string;
  lock_at: string;
  door_ids?: string[];
  door_timings?: Record<string, { unlock_at?: string; lock_at?: string }>;
}

const WEEKDAY_MAP: Record<string, DayOfWeek> = {
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
  sunday: 'sunday',
};

function getLocalDayAndHHMM(epochMs: number, timeZone: string): { day: DayOfWeek; hhmm: string } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/Chicago',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(epochMs));
    let weekdayStr = 'monday';
    let hour = '00';
    let minute = '00';
    for (const p of parts) {
      if (p.type === 'weekday') weekdayStr = p.value.toLowerCase();
      if (p.type === 'hour') hour = p.value === '24' ? '00' : p.value.padStart(2, '0');
      if (p.type === 'minute') minute = p.value.padStart(2, '0');
    }
    return {
      day: WEEKDAY_MAP[weekdayStr] || 'monday',
      hhmm: `${hour}:${minute}`,
    };
  } catch {
    const d = new Date(epochMs);
    const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return { day: days[d.getDay()], hhmm: `${hh}:${mm}` };
  }
}

export function matchesCustomTimeRange(
  eventTimeMs: number,
  ranges: UnlockSnapshotTimeRange[] | undefined,
  timeZone: string
): boolean {
  if (!Array.isArray(ranges) || ranges.length === 0) return false;
  const { day, hhmm } = getLocalDayAndHHMM(eventTimeMs, timeZone);

  for (const r of ranges) {
    if (!Array.isArray(r.days) || !r.days.includes(day)) continue;
    const start = (r.start_time || '').trim();
    const end = (r.end_time || '').trim();
    if (!start || !end) continue;

    if (start <= end) {
      if (hhmm >= start && hhmm <= end) return true;
    } else {
      // Overnight range e.g. 22:00 - 06:00
      if (hhmm >= start || hhmm <= end) return true;
    }
  }
  return false;
}

export function matchesPcoWindow(
  eventTimeMs: number,
  doorId: string,
  windows: ScheduleWindowSnapshotDoc[],
  config: UnlockSnapshotConfig
): boolean {
  const bufferMs = Math.max(0, Number(config.pco_buffer_min ?? 15)) * 60 * 1000;
  const serviceIds = Array.isArray(config.pco_service_type_ids)
    ? config.pco_service_type_ids.filter(Boolean)
    : [];
  const groupIds = Array.isArray(config.pco_group_ids)
    ? config.pco_group_ids.filter(Boolean)
    : [];
  const filterByResource = serviceIds.length > 0 || groupIds.length > 0;

  for (const w of windows) {
    if (w.status === 'cancelled') continue;
    if (Array.isArray(w.door_ids) && w.door_ids.length > 0 && !w.door_ids.includes(doorId)) {
      continue;
    }

    if (filterByResource) {
      const matchesService = Boolean(w.pco_service_type_id && serviceIds.includes(w.pco_service_type_id));
      const matchesGroup = Boolean(w.pco_group_id && groupIds.includes(w.pco_group_id));
      if (!matchesService && !matchesGroup) continue;
    }

    const doorTiming = w.door_timings?.[doorId];
    const startStr = doorTiming?.unlock_at || w.unlock_at;
    const endStr = doorTiming?.lock_at || w.lock_at;
    const startMs = Date.parse(startStr);
    const endMs = Date.parse(endStr);
    if (isNaN(startMs) || isNaN(endMs)) continue;

    if (eventTimeMs >= startMs - bufferMs && eventTimeMs <= endMs + bufferMs) {
      return true;
    }
  }
  return false;
}

export interface RuleEvaluationResult {
  shouldCapture: boolean;
  cameraId?: string;
  reason?: string;
}

export function evaluateUnlockSnapshotRule(
  entry: AccessLogEntry,
  door: DoorSnapshotDoc | null,
  windows: ScheduleWindowSnapshotDoc[],
  timeZone: string
): RuleEvaluationResult {
  if (!door) return { shouldCapture: false, reason: 'door_not_found' };

  const cfg = door.unlock_snapshot_config;
  if (!cfg || !cfg.enabled || cfg.mode === 'off') {
    return { shouldCapture: false, reason: 'capture_disabled' };
  }

  const isUnlock = entry.event_type === 'door_unlock' && entry.event_result === 'success';
  const isDenied = entry.event_type === 'access_denied' || entry.event_result === 'denied';
  if (!isUnlock && !(cfg.capture_on_denied && isDenied)) {
    return { shouldCapture: false, reason: 'event_type_ignored' };
  }

  const cameraId = cfg.camera_id || door.primary_camera_id || door.camera_ids?.[0];
  if (!cameraId) {
    return { shouldCapture: false, reason: 'no_linked_camera' };
  }

  const eventTimeMs = Date.parse(entry.timestamp);
  if (isNaN(eventTimeMs)) {
    return { shouldCapture: false, reason: 'invalid_timestamp' };
  }

  const inPcoWindow = matchesPcoWindow(eventTimeMs, door.id, windows, cfg);

  switch (cfg.mode) {
    case 'always':
      return { shouldCapture: true, cameraId };

    case 'outside_pco_windows':
      return inPcoWindow
        ? { shouldCapture: false, cameraId, reason: 'inside_pco_window' }
        : { shouldCapture: true, cameraId };

    case 'during_pco_windows':
      return inPcoWindow
        ? { shouldCapture: true, cameraId }
        : { shouldCapture: false, cameraId, reason: 'outside_pco_window' };

    case 'custom_schedule': {
      const inRange = matchesCustomTimeRange(eventTimeMs, cfg.custom_ranges, timeZone);
      if (!inRange) {
        return { shouldCapture: false, cameraId, reason: 'outside_custom_range' };
      }
      if (cfg.skip_during_pco_windows && inPcoWindow) {
        return { shouldCapture: false, cameraId, reason: 'inside_pco_window' };
      }
      return { shouldCapture: true, cameraId };
    }

    default:
      return { shouldCapture: false, reason: 'unknown_mode' };
  }
}

export async function captureUnlockEventSnapshot(
  orgId: string,
  cameraId: string,
  logId: string,
  protectManager: ProtectManager
): Promise<string | null> {
  if (!protectManager.isConfigured()) return null;
  try {
    const db = getDb();
    const camSnap = await db.doc(`organizations/${orgId}/cameras/${cameraId}`).get();
    const consoleId = camSnap.exists ? (camSnap.data()?.console_id as string | undefined) : undefined;
    const unifiCamId = (camSnap.exists ? (camSnap.data()?.unifi_camera_id as string | undefined) : undefined) || cameraId;

    const primaryClient = protectManager.getClientForConsole(consoleId);
    const candidates = primaryClient
      ? [primaryClient, ...protectManager.getConsoles().map((c) => c.client).filter((c) => c !== primaryClient)]
      : protectManager.getConsoles().map((c) => c.client);

    let jpeg: Buffer | null = null;
    for (const client of candidates) {
      try {
        jpeg = await client.getSnapshot(unifiCamId, true);
        break;
      } catch {
        try {
          jpeg = await client.getSnapshot(unifiCamId, false);
          break;
        } catch {
          // Try next console
        }
      }
    }

    if (!jpeg) {
      logger.warn(`[UnlockSnapshot] Could not capture snapshot for camera ${cameraId} (log ${logId})`);
      return null;
    }

    const storagePath = `organizations/${orgId}/cameras/${cameraId}/unlock_events/${logId}.jpg`;
    await uploadCameraSnapshot(storagePath, jpeg);
    return storagePath;
  } catch (err: any) {
    logger.warn(`[UnlockSnapshot] Failed capturing unlock snapshot for log ${logId}: ${err.message}`);
    return null;
  }
}
