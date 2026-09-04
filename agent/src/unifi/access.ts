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
  is_held_unlocked?: boolean;
  hold_unlock_end_time?: number | null;
  [key: string]: unknown;
}

interface UnifiApiResponse<T> {
  data: T;
  code: string;
  msg?: string;
}

export type LockRuleType = 'lock_early' | 'unlock_early' | 'custom' | 'schedule';

export interface LockRulePayload {
  type: LockRuleType;
  /** Duration in minutes; only used when type === 'custom' */
  interval?: number;
}

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface UnifiScheduleTimeSlot {
  start_time: string; // "HH:MM" e.g. "08:00"
  end_time: string;   // "HH:MM" e.g. "17:00"
}

export interface UnifiWeeklyScheduleDay {
  day: DayOfWeek;
  active: boolean;
  slots: UnifiScheduleTimeSlot[];
}

export interface UnifiSchedule {
  id: string;
  org_id?: string;
  unifi_schedule_id: string;
  name: string;
  type?: 'unlock' | 'access' | 'custom' | string;
  is_default?: boolean;
  weekly_schedule: UnifiWeeklyScheduleDay[];
  door_ids?: string[];
  door_labels?: string[];
  holiday_group_id?: string;
  raw_data?: Record<string, unknown>;
  last_synced?: string;
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string;
  created_at?: string;
  updated_at?: string;
}

export type VisitorStatus = 'active' | 'upcoming' | 'expired' | 'revoked' | 'pending';

export interface UnifiVisitor {
  id: string;
  org_id?: string;
  unifi_visitor_id?: string;
  first_name: string;
  last_name?: string;
  full_name?: string;
  mobile_phone?: string;
  email?: string;
  pin_code?: string;
  start_time: string;
  end_time: string;
  door_ids: string[];
  door_labels?: string[];
  status?: VisitorStatus;
  purpose?: string;
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string;
  raw_data?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export function normalizeUnifiVisitor(raw: any, orgId = ''): UnifiVisitor {
  const id = String(raw.id || raw.unique_id || raw._id || '');
  const firstName = String(raw.first_name || raw.firstName || (raw.name ? String(raw.name).split(' ')[0] : 'Visitor'));
  const lastName = String(raw.last_name || raw.lastName || (raw.name ? String(raw.name).split(' ').slice(1).join(' ') : ''));
  const fullName = String(raw.full_name || raw.name || `${firstName} ${lastName}`.trim());

  let startTimeIso = new Date().toISOString();
  if (raw.start_time || raw.startTime) {
    const val = raw.start_time || raw.startTime;
    if (typeof val === 'number') {
      startTimeIso = new Date(val > 10000000000 ? val : val * 1000).toISOString();
    } else {
      startTimeIso = new Date(val).toISOString();
    }
  }

  let endTimeIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  if (raw.end_time || raw.endTime) {
    const val = raw.end_time || raw.endTime;
    if (typeof val === 'number') {
      endTimeIso = new Date(val > 10000000000 ? val : val * 1000).toISOString();
    } else {
      endTimeIso = new Date(val).toISOString();
    }
  }

  const doorIds: string[] = [];
  const doorLabels: string[] = [];
  if (Array.isArray(raw.doors || raw.door_ids || raw.device_ids)) {
    for (const d of raw.doors || raw.door_ids || raw.device_ids) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        if (d.id || d.unique_id) doorIds.push(String(d.id || d.unique_id));
        if (d.name || d.label) doorLabels.push(String(d.name || d.label));
      }
    }
  }

  // Derive status
  const now = Date.now();
  const startMs = new Date(startTimeIso).getTime();
  const endMs = new Date(endTimeIso).getTime();
  let status: VisitorStatus = 'active';
  if (raw.status === 'canceled' || raw.status === 'revoked') {
    status = 'revoked';
  } else if (now < startMs) {
    status = 'upcoming';
  } else if (now >= endMs) {
    status = 'expired';
  }

  return {
    id,
    org_id: orgId,
    unifi_visitor_id: id,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    mobile_phone: raw.mobile_phone || raw.phone,
    email: raw.email,
    pin_code: raw.pin_code || raw.pin || raw.passcode,
    start_time: startTimeIso,
    end_time: endTimeIso,
    door_ids: doorIds,
    door_labels: doorLabels,
    status,
    purpose: raw.purpose || raw.note || raw.remarks,
    raw_data: raw,
    last_synced: new Date().toISOString(),
    sync_status: 'synced',
  } as any;
}

export function serializeUnifiVisitor(visitor: Partial<UnifiVisitor>): any {
  const base: Record<string, any> = visitor.raw_data ? { ...visitor.raw_data } : {};

  if (visitor.first_name) base.first_name = visitor.first_name;
  if (visitor.last_name !== undefined) base.last_name = visitor.last_name;
  if (visitor.mobile_phone !== undefined) base.mobile_phone = visitor.mobile_phone;
  if (visitor.email !== undefined) base.email = visitor.email;
  if (visitor.purpose !== undefined) base.purpose = visitor.purpose;

  if (visitor.door_ids) {
    base.doors = visitor.door_ids;
    base.door_ids = visitor.door_ids;
  }

  if (visitor.start_time) {
    const ms = new Date(visitor.start_time).getTime();
    base.start_time = Math.floor(ms / 1000);
    base.start_time_millis = ms;
  }

  if (visitor.end_time) {
    const ms = new Date(visitor.end_time).getTime();
    base.end_time = Math.floor(ms / 1000);
    base.end_time_millis = ms;
  }

  if (visitor.pin_code) {
    base.pin_code = String(visitor.pin_code);
    base.pin = String(visitor.pin_code);
  }

  return base;
}

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export function normalizeUnifiSchedule(raw: any, orgId = ''): UnifiSchedule {
  const id = String(raw.id || raw.unique_id || raw._id || '');
  const name = String(raw.name || raw.schedule_name || raw.alias || 'Schedule');
  const type = raw.type || (raw.is_unlock ? 'unlock' : 'access');
  const isDefault = Boolean(raw.is_default || raw.default);
  const holidayGroupId = raw.holiday_group_id || raw.holiday_id;

  const weeklySchedule: UnifiWeeklyScheduleDay[] = DAYS_OF_WEEK.map((day) => ({
    day,
    active: false,
    slots: [],
  }));

  const rawWeekly = raw.weekly_schedule || raw.week_schedule || raw.schedule || raw.schedules;
  if (Array.isArray(rawWeekly)) {
    for (const item of rawWeekly) {
      let targetDay: DayOfWeek | undefined;
      if (typeof item.day === 'string') {
        const d = item.day.toLowerCase() as DayOfWeek;
        if (DAYS_OF_WEEK.includes(d)) targetDay = d;
      } else if (typeof item.day_of_week === 'number') {
        const idx = item.day_of_week === 0 ? 6 : item.day_of_week - 1;
        targetDay = DAYS_OF_WEEK[idx] || DAYS_OF_WEEK[item.day_of_week];
      }

      if (targetDay) {
        const dayEntry = weeklySchedule.find((w) => w.day === targetDay);
        if (dayEntry) {
          if (Array.isArray(item.slots) && item.slots.length > 0) {
            dayEntry.active = item.active !== false;
            dayEntry.slots = item.slots.map((s: any) => ({
              start_time: String(s.start_time || s.start || '08:00'),
              end_time: String(s.end_time || s.end || '17:00'),
            }));
          } else if (item.start_time || item.start) {
            dayEntry.active = true;
            dayEntry.slots.push({
              start_time: String(item.start_time || item.start || '08:00'),
              end_time: String(item.end_time || item.end || '17:00'),
            });
          }
        }
      }
    }
  } else if (rawWeekly && typeof rawWeekly === 'object') {
    for (const day of DAYS_OF_WEEK) {
      const dayData = rawWeekly[day] || rawWeekly[day.slice(0, 3)];
      const dayEntry = weeklySchedule.find((w) => w.day === day);
      if (dayEntry && dayData) {
        if (Array.isArray(dayData) && dayData.length > 0) {
          dayEntry.active = true;
          dayEntry.slots = dayData.map((s: any) => ({
            start_time: String(s.start_time || s.start || '08:00'),
            end_time: String(s.end_time || s.end || '17:00'),
          }));
        } else if (typeof dayData === 'object' && (dayData.start_time || dayData.start)) {
          dayEntry.active = true;
          dayEntry.slots = [{
            start_time: String(dayData.start_time || dayData.start || '08:00'),
            end_time: String(dayData.end_time || dayData.end || '17:00'),
          }];
        }
      }
    }
  }

  const doorIds: string[] = [];
  const doorLabels: string[] = [];
  if (Array.isArray(raw.doors || raw.door_ids || raw.device_ids)) {
    for (const d of raw.doors || raw.door_ids || raw.device_ids) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        if (d.id || d.unique_id) doorIds.push(String(d.id || d.unique_id));
        if (d.name || d.label) doorLabels.push(String(d.name || d.label));
      }
    }
  }

  return {
    id,
    org_id: orgId,
    unifi_schedule_id: id,
    name,
    type,
    is_default: isDefault,
    weekly_schedule: weeklySchedule,
    door_ids: doorIds,
    door_labels: doorLabels,
    holiday_group_id: holidayGroupId,
    raw_data: raw,
    last_synced: new Date().toISOString(),
    sync_status: 'synced',
  };
}

export function serializeUnifiSchedule(schedule: Partial<UnifiSchedule>): any {
  const base: Record<string, any> = schedule.raw_data ? { ...schedule.raw_data } : {};

  if (schedule.name) base.name = schedule.name;
  if (schedule.type) base.type = schedule.type;
  if (schedule.holiday_group_id !== undefined) base.holiday_group_id = schedule.holiday_group_id;

  if (schedule.weekly_schedule) {
    base.weekly_schedule = schedule.weekly_schedule.map((dayObj, idx) => ({
      day: dayObj.day,
      day_of_week: idx + 1,
      active: dayObj.active,
      slots: dayObj.active ? dayObj.slots : [],
    }));
    const weekScheduleObj: Record<string, any[]> = {};
    for (const d of schedule.weekly_schedule) {
      weekScheduleObj[d.day] = d.active ? d.slots : [];
    }
    base.week_schedule = weekScheduleObj;
  }

  if (schedule.door_ids) {
    base.door_ids = schedule.door_ids;
  }

  return base;
}

// ---------------------------------------------------------------------------
// Device helpers
// ---------------------------------------------------------------------------

function isHubDevice(d: any): boolean {
  if (Array.isArray(d?.capabilities)) {
    if (d.capabilities.includes('is_hub') || d.capabilities.includes('identity_is_hub')) return true;
    if (d.capabilities.includes('is_reader') || d.capabilities.includes('identity_is_reader')) return false;
  }
  const t = String(d?.device_type || d?.type || d?.model || d?.name || '').toLowerCase();
  if (t.includes('reader')) return false;
  return (
    t.includes('hub') ||
    t.includes('uah') ||
    t.includes('eah') ||
    t.includes('uret') ||
    t.includes('ultra') ||
    t.includes('gate') ||
    t.includes('lock')
  );
}

function isReaderDevice(d: any): boolean {
  if (Array.isArray(d?.capabilities)) {
    if (d.capabilities.includes('is_reader') || d.capabilities.includes('identity_is_reader')) return true;
    if (d.capabilities.includes('is_hub') || d.capabilities.includes('identity_is_hub')) return false;
  }
  const t = String(d?.device_type || d?.type || d?.model || d?.name || '').toLowerCase();
  return (
    t.includes('reader') ||
    t.includes('pro') ||
    t.includes('g2') ||
    t.includes('lite') ||
    t.includes('intercom')
  );
}

function parseHubDoorStatus(
  hubDevice: any,
  port: 'd1' | 'd2' = 'd1'
): {
  relayStatus: 'lock' | 'unlock';
  positionStatus: 'open' | 'close';
  isHeld: boolean;
  holdEndTime: number | null;
} {
  if (!hubDevice) {
    return { relayStatus: 'lock', positionStatus: 'close', isHeld: false, holdEndTime: null };
  }

  const cfgs = hubDevice.configs || [];
  const map = new Map<string, string>();
  for (const c of cfgs) {
    if (c.key && c.value !== undefined) {
      map.set(c.key, String(c.value));
    }
  }

  // 1. Direct relay outputs: 'on' = unlocked/energized, 'off' = locked
  let isUnlocked = false;
  if (port === 'd2') {
    isUnlocked = map.get('output_d2_lock_relay') === 'on';
  } else {
    isUnlocked = map.get('output_d1_lock_relay') === 'on' || map.get('input_state_rly-lock_dry') === 'on';
  }

  // 2. Temporary hold-open / unlock schedules
  const nowSec = Math.floor(Date.now() / 1000);
  const lockEndTime = parseInt(map.get('lock_end_time') || '0', 10);
  const tempUnlockEnd = parseInt(map.get('temporary_unlock_suspend_end_time') || '0', 10);
  const isHeld = lockEndTime > nowSec || tempUnlockEnd > nowSec;
  if (isHeld) {
    isUnlocked = true;
  }

  // 3. Door position sensor (DPS): 'off' = open circuit (door open), 'on' = closed
  const dps = port === 'd2'
    ? map.get('input_d2_dps')
    : (map.get('input_d1_dps') || map.get('input_state_dps'));

  let positionStatus: 'open' | 'close' = 'close';
  if (dps === 'off') {
    positionStatus = 'open';
  } else if (dps === 'on') {
    positionStatus = 'close';
  }

  return {
    relayStatus: isUnlocked ? 'unlock' : 'lock',
    positionStatus,
    isHeld,
    holdEndTime: isHeld ? Math.max(lockEndTime, tempUnlockEnd) : null,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class UnifiAccessClient {
  private readonly http: AxiosInstance;
  private host: string;
  private doorToHubMap: Map<string, string> = new Map();
  private doorToPortMap: Map<string, 'd1' | 'd2'> = new Map();

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
        // Surface UniFi API application-level error codes even if HTTP status is 200 OK
        if (response.data && typeof response.data === 'object') {
          const rawCode = (response.data as any).code;
          if (rawCode !== undefined && rawCode !== null) {
            const msg =
              (response.data as any).msg ||
              (response.data as any).message;
            const msgStr = typeof msg === 'string' ? msg.toLowerCase().trim() : '';

            // UniFi APIs return code 0, 1, 200, 'SUCCESS', 'OK', or msg 'success'/'ok' for successful responses
            const isSuccess =
              rawCode === 'SUCCESS' ||
              rawCode === 'success' ||
              rawCode === 0 ||
              rawCode === '0' ||
              rawCode === 1 ||
              rawCode === '1' ||
              rawCode === 200 ||
              rawCode === '200' ||
              rawCode === 'OK' ||
              rawCode === 'ok' ||
              msgStr === 'success' ||
              msgStr === 'ok';

            if (!isSuccess) {
              const errorText = msg || `UniFi API error code: ${rawCode}`;
              logger.warn(`UniFi API error response [${rawCode}] ${response.config.url}: ${errorText}`);
              const err: any = new Error(`UniFi API error [${rawCode}]: ${errorText}`);
              err.response = response;
              err.code = rawCode;
              return Promise.reject(err);
            }
          }
        }
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

  /**
   * Populate internal mapping of door IDs to device/hub IDs from v2 devices API.
   */
  private async populateDoorToHubMap(): Promise<void> {
    try {
      const response = await this.http.get<{
        code?: number | string;
        data?: Array<any>;
      }>('/proxy/access/api/v2/devices');

      const devices = response.data?.data || [];

      // Pass 1: Multi-port hub extensions (e.g. UA Retrofit Hub 2)
      for (const d of devices) {
        if (d.extensions && Array.isArray(d.extensions)) {
          for (const ext of d.extensions) {
            if (ext.target_type === 'door' && ext.target_value) {
              const port = ext.source_id === 'port2' ? 'd2' : 'd1';
              this.doorToHubMap.set(ext.target_value, d.unique_id);
              this.doorToPortMap.set(ext.target_value, port);
              logger.info(
                `[UniFi] Mapped Hub ${d.unique_id} (${ext.source_id}) to door ${ext.target_value} (${ext.target_name || 'Door'})`
              );
            }
          }
        }
      }

      // Pass 2: Hubs with d.door or location_id
      for (const d of devices) {
        const doorId = d.door?.unique_id || d.location_id;
        if (doorId && isHubDevice(d) && !this.doorToHubMap.has(doorId)) {
          this.doorToHubMap.set(doorId, d.unique_id);
          this.doorToPortMap.set(doorId, 'd1');
          logger.info(`[UniFi] Mapped Hub ${d.unique_id} to door ${doorId} (${d.door?.name || d.name || 'Door'})`);
        }
      }

      // Pass 3: Readers with connected_uah_id
      for (const d of devices) {
        const doorId = d.door?.unique_id || d.location_id;
        const linkedHubId = d.connected_uah_id || d.hub_id || d.connected_hub_id;
        if (doorId && linkedHubId) {
          this.doorToHubMap.set(doorId, linkedHubId);
          logger.info(`[UniFi] Mapped Hub ${linkedHubId} (from reader ${d.unique_id}) to door ${doorId}`);
        }
      }
    } catch (err: any) {
      logger.debug(`[UniFi] Failed to populate door to hub map: ${err.message}`);
    }
  }

  /**
   * Dynamically update host and token (e.g. after cloud config pull or token rotation).
   */
  updateCredentials(host: string, token: string, skipTlsVerify?: boolean): void {
    this.host = host.replace(/\/$/, '');
    this.http.defaults.baseURL = this.host;
    this.http.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    this.http.defaults.headers.common['X-API-KEY'] = token;
    if (skipTlsVerify !== undefined) {
      this.http.defaults.httpsAgent = new https.Agent({
        rejectUnauthorized: !skipTlsVerify,
      });
    }
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
        // Asynchronously populate door-to-hub mapping in background
        this.populateDoorToHubMap().catch(() => {});
        return response.data.data;
      }
    } catch {
      // Fall through
    }

    try {
      const response = await this.http.get<UnifiApiResponse<UnifiDoor[]>>(
        '/proxy/access/integration/v1/developer/doors'
      );
      if (Array.isArray(response.data?.data)) {
        this.populateDoorToHubMap().catch(() => {});
        return response.data.data;
      }
    } catch {
      // Fall through to v2 API
    }

    // UniFi Access v2 API
    const response = await this.http.get<{
      code: number;
      data: Array<any>;
    }>('/proxy/access/api/v2/devices');

    const devices = response.data?.data || [];
    const deviceById = new Map<string, any>();
    for (const d of devices) {
      deviceById.set(d.unique_id, d);
    }

    // Ensure doorToHubMap and doorToPortMap are populated
    for (const d of devices) {
      if (d.extensions && Array.isArray(d.extensions)) {
        for (const ext of d.extensions) {
          if (ext.target_type === 'door' && ext.target_value) {
            const port = ext.source_id === 'port2' ? 'd2' : 'd1';
            this.doorToHubMap.set(ext.target_value, d.unique_id);
            this.doorToPortMap.set(ext.target_value, port);
          }
        }
      }
    }
    for (const d of devices) {
      const doorId = d.door?.unique_id || d.location_id;
      if (doorId && isHubDevice(d) && !this.doorToHubMap.has(doorId)) {
        this.doorToHubMap.set(doorId, d.unique_id);
        this.doorToPortMap.set(doorId, 'd1');
      }
    }
    for (const d of devices) {
      const doorId = d.door?.unique_id || d.location_id;
      const linkedHubId = d.connected_uah_id || d.hub_id || d.connected_hub_id;
      if (doorId && linkedHubId) {
        this.doorToHubMap.set(doorId, linkedHubId);
      }
    }

    const doorMap = new Map<string, UnifiDoor>();

    // Pass 1: Add doors from multi-port hub extensions (e.g. Front Door & Main Door on UA Retrofit Hub 2)
    for (const d of devices) {
      if (d.extensions && Array.isArray(d.extensions)) {
        for (const ext of d.extensions) {
          if (ext.target_type === 'door' && ext.target_value) {
            const doorId = ext.target_value;
            const port = ext.source_id === 'port2' ? 'd2' : 'd1';
            const status = parseHubDoorStatus(d, port);
            doorMap.set(doorId, {
              id: doorId,
              name: ext.target_name || d.alias || d.name,
              door_lock_relay_status: status.relayStatus,
              door_position_status: status.positionStatus,
              is_held_unlocked: status.isHeld,
              hold_unlock_end_time: status.holdEndTime,
              type: d.device_type,
              location_id: d.location_id || '',
              full_name: `${d.alias || d.name} - ${ext.target_name || 'Door'}`,
              device_state: d.device_state || d.state || 'connected',
            });
          }
        }
      }
    }

    // Pass 2: Add or enhance doors from devices with d.door
    for (const d of devices) {
      if (d.door && d.door.unique_id) {
        const doorId = d.door.unique_id;
        const isHub = isHubDevice(d);
        const hubId = this.doorToHubMap.get(doorId);
        const hub = hubId ? deviceById.get(hubId) : (isHub ? d : null);
        const port = this.doorToPortMap.get(doorId) || 'd1';
        const status = parseHubDoorStatus(hub, port);

        const existing = doorMap.get(doorId);
        if (!existing) {
          doorMap.set(doorId, {
            id: doorId,
            name: d.door.name || d.alias || d.name,
            door_lock_relay_status: status.relayStatus,
            door_position_status: status.positionStatus,
            is_held_unlocked: status.isHeld,
            hold_unlock_end_time: status.holdEndTime,
            type: d.device_type,
            location_id: d.door.up_id || '',
            full_name: d.door.full_name || d.door.name,
            device_state: d.device_state || d.state || 'connected',
          });
        } else {
          // If already in doorMap (from hub extensions), prefer official name from reader/door if cleaner
          if (d.door.name) {
            existing.name = d.door.name;
          }
          if (d.door.full_name) {
            existing.full_name = d.door.full_name;
          }
          existing.door_lock_relay_status = status.relayStatus;
          existing.door_position_status = status.positionStatus;
          existing.is_held_unlocked = status.isHeld;
          existing.hold_unlock_end_time = status.holdEndTime;
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
   * Unlock a door.
   * Performs an immediate physical unlock (relay trigger) and optionally applies
   * a hold-open lock rule for the requested duration.
   *
   * @param doorId      - UniFi door ID
   * @param durationMin - How long to hold the door unlocked, in minutes (if supported)
   */
  async unlockDoor(doorId: string, durationMin: number = 0): Promise<void> {
    let unlocked = false;
    let lastError: Error | null = null;

    let hubId = this.doorToHubMap.get(doorId);
    if (!hubId) {
      await this.populateDoorToHubMap().catch(() => {});
      hubId = this.doorToHubMap.get(doorId);
    }

    const attempts: Array<{ name: string; fn: () => Promise<any> }> = [];

    // 1. If we know the physical hub ID, try hub relay_unlock first (UniFi OS Access v2 standard)
    if (hubId) {
      attempts.push({
        name: `PUT /proxy/access/api/v2/device/${hubId}/relay_unlock (door_id: ${doorId})`,
        fn: () => this.http.put(`/proxy/access/api/v2/device/${encodeURIComponent(hubId!)}/relay_unlock`, { door_id: doorId }),
      });
      attempts.push({
        name: `PUT /proxy/access/api/v2/device/${hubId}/relay_unlock`,
        fn: () => this.http.put(`/proxy/access/api/v2/device/${encodeURIComponent(hubId!)}/relay_unlock`, {}),
      });
      attempts.push({
        name: `POST /proxy/access/api/v2/device/${hubId}/relay_unlock`,
        fn: () => this.http.post(`/proxy/access/api/v2/device/${encodeURIComponent(hubId!)}/relay_unlock`, { door_id: doorId }),
      });
    }

    // 2. Developer API endpoints (if permitted on console)
    attempts.push(
      {
        name: 'PUT /proxy/access/integration/v1/developer/doors/.../unlock',
        fn: () => this.http.put(`/proxy/access/integration/v1/developer/doors/${encodeURIComponent(doorId)}/unlock`, {}),
      },
      {
        name: 'POST /proxy/access/integration/v1/developer/doors/.../unlock',
        fn: () => this.http.post(`/proxy/access/integration/v1/developer/doors/${encodeURIComponent(doorId)}/unlock`, {}),
      },
      {
        name: 'PUT /api/v1/developer/doors/.../unlock',
        fn: () => this.http.put(`/api/v1/developer/doors/${encodeURIComponent(doorId)}/unlock`, {}),
      },
      {
        name: 'POST /api/v1/developer/doors/.../unlock',
        fn: () => this.http.post(`/api/v1/developer/doors/${encodeURIComponent(doorId)}/unlock`, {}),
      }
    );

    for (const att of attempts) {
      try {
        await att.fn();
        unlocked = true;
        logger.info(`[UniFi] ✓ Door ${doorId} unlocked via ${att.name}`);
        break;
      } catch (err: any) {
        lastError = err;
        logger.debug(`[UniFi] Unlock attempt ${att.name} failed: ${err.message}`);
      }
    }

    // 3. Apply temporary hold-open lock rule if duration was specified
    if (durationMin > 0) {
      const holdRulePayloads: LockRulePayload[] = [
        { type: 'custom', interval: durationMin },
        { type: 'keep_unlock' as any },
      ];

      let holdRuleApplied = false;
      const holdEndpoints: string[] = [];
      if (hubId) {
        holdEndpoints.push(`/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`);
      }
      holdEndpoints.push(
        `/proxy/access/integration/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
        `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`
      );

      for (const endpoint of holdEndpoints) {
        for (const payload of holdRulePayloads) {
          try {
            await this.http.put(endpoint, payload);
            holdRuleApplied = true;
            logger.info(`[UniFi] Door ${doorId} hold rule applied (${payload.type}) via ${endpoint}`);
            break;
          } catch {}
        }
        if (holdRuleApplied) break;
      }

      if (holdRuleApplied) {
        unlocked = true;
      } else if (!unlocked) {
        throw new Error(
          `Failed to unlock door ${doorId}: ${lastError?.message || 'Unsupported door command'}`
        );
      } else {
        logger.info(
          `[UniFi] Door ${doorId} unlocked via relay. Note: hold-open schedule rule is not supported by this hardware model.`
        );
      }
    } else if (!unlocked) {
      throw new Error(
        `Failed to unlock door ${doorId}: ${lastError?.message || 'Door unlock failed'}`
      );
    }
  }

  /**
   * Lock a door immediately, overriding/clearing any active hold rule.
   * @param doorId - UniFi door ID
   */
  async lockDoor(doorId: string): Promise<void> {
    let locked = false;
    let lastError: Error | null = null;

    let hubId = this.doorToHubMap.get(doorId);
    if (!hubId) {
      await this.populateDoorToHubMap().catch(() => {});
      hubId = this.doorToHubMap.get(doorId);
    }

    const resetPayloads = [
      { type: 'reset' },
      { type: 'lock_early' },
      { type: 'keep_lock' },
    ];

    const lockEndpoints: string[] = [];
    if (hubId) {
      lockEndpoints.push(`/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`);
    }
    lockEndpoints.push(
      `/proxy/access/integration/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`,
      `/api/v1/developer/doors/${encodeURIComponent(doorId)}/lock_rule`
    );

    for (const endpoint of lockEndpoints) {
      for (const payload of resetPayloads) {
        try {
          await this.http.put(endpoint, payload);
          locked = true;
          logger.info(`[UniFi] Door ${doorId} locked (${payload.type}) via ${endpoint}`);
          return;
        } catch (err: any) {
          lastError = err;
        }
      }
    }

    if (!locked) {
      throw new Error(`Failed to lock door ${doorId}: ${lastError?.message || 'Door lock failed'}`);
    }
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

  /**
   * Fetch all schedules from UniFi Access.
   * Tries Developer v1 -> Integration v1 -> Access v2.
   */
  async getSchedules(): Promise<UnifiSchedule[]> {
    // 1. Try Developer API v1
    try {
      const res = await this.http.get<UnifiApiResponse<any[]>>('/api/v1/developer/schedules');
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiSchedule(item));
      }
    } catch {
      // Fall through
    }

    // 2. Try Integration v1 via proxy
    try {
      const res = await this.http.get<UnifiApiResponse<any[]>>(
        '/proxy/access/integration/v1/developer/schedules'
      );
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiSchedule(item));
      }
    } catch {
      // Fall through
    }

    // 3. Try UniFi Access v2 API
    try {
      const res = await this.http.get<{
        code: number;
        data: any[];
      }>('/proxy/access/api/v2/schedules');
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiSchedule(item));
      }
    } catch (err) {
      logger.warn(`UniFi getSchedules failed on all endpoints: ${err}`);
      throw err;
    }

    return [];
  }

  /**
   * Get a single schedule by ID.
   */
  async getSchedule(scheduleId: string): Promise<UnifiSchedule> {
    try {
      const res = await this.http.get<UnifiApiResponse<any>>(
        `/api/v1/developer/schedules/${encodeURIComponent(scheduleId)}`
      );
      if (res.data?.data) return normalizeUnifiSchedule(res.data.data);
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.get<UnifiApiResponse<any>>(
        `/proxy/access/integration/v1/developer/schedules/${encodeURIComponent(scheduleId)}`
      );
      if (res.data?.data) return normalizeUnifiSchedule(res.data.data);
    } catch {
      // Fall through
    }

    const res = await this.http.get<{ code: number; data: any }>(
      `/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`
    );
    if (res.data?.data) return normalizeUnifiSchedule(res.data.data);
    throw new Error(`Schedule ${scheduleId} not found in UniFi Access.`);
  }

  /**
   * Create a new schedule in UniFi Access.
   */
  async createSchedule(schedule: Partial<UnifiSchedule>): Promise<UnifiSchedule> {
    const payload = serializeUnifiSchedule(schedule);

    try {
      const res = await this.http.post<UnifiApiResponse<any>>(
        '/api/v1/developer/schedules',
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi schedule created via Developer API: ${res.data.data.id || schedule.name}`);
        return normalizeUnifiSchedule(res.data.data);
      }
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.post<UnifiApiResponse<any>>(
        '/proxy/access/integration/v1/developer/schedules',
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi schedule created via Integration API: ${res.data.data.id || schedule.name}`);
        return normalizeUnifiSchedule(res.data.data);
      }
    } catch {
      // Fall through
    }

    const res = await this.http.post<{ code: number; data: any }>(
      '/proxy/access/api/v2/schedules',
      payload
    );
    logger.info(`UniFi schedule created via v2 API: ${res.data?.data?.id || schedule.name}`);
    return normalizeUnifiSchedule(res.data?.data ?? payload);
  }

  /**
   * Update an existing schedule in UniFi Access.
   */
  async updateSchedule(scheduleId: string, updates: Partial<UnifiSchedule>): Promise<UnifiSchedule> {
    const payload = serializeUnifiSchedule(updates);

    try {
      const res = await this.http.put<UnifiApiResponse<any>>(
        `/api/v1/developer/schedules/${encodeURIComponent(scheduleId)}`,
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi schedule ${scheduleId} updated via Developer API.`);
        return normalizeUnifiSchedule(res.data.data);
      }
      return normalizeUnifiSchedule({ id: scheduleId, ...payload });
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.put<UnifiApiResponse<any>>(
        `/proxy/access/integration/v1/developer/schedules/${encodeURIComponent(scheduleId)}`,
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi schedule ${scheduleId} updated via Integration API.`);
        return normalizeUnifiSchedule(res.data.data);
      }
      return normalizeUnifiSchedule({ id: scheduleId, ...payload });
    } catch {
      // Fall through
    }

    const res = await this.http.put<{ code: number; data: any }>(
      `/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`,
      payload
    );
    logger.info(`UniFi schedule ${scheduleId} updated via v2 API.`);
    return normalizeUnifiSchedule(res.data?.data ?? { id: scheduleId, ...payload });
  }

  /**
   * Delete a schedule from UniFi Access.
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      await this.http.delete(
        `/api/v1/developer/schedules/${encodeURIComponent(scheduleId)}`
      );
      logger.info(`UniFi schedule ${scheduleId} deleted via Developer API.`);
      return;
    } catch {
      // Fall through
    }

    try {
      await this.http.delete(
        `/proxy/access/integration/v1/developer/schedules/${encodeURIComponent(scheduleId)}`
      );
      logger.info(`UniFi schedule ${scheduleId} deleted via Integration API.`);
      return;
    } catch {
      // Fall through
    }

    await this.http.delete(
      `/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`
    );
    logger.info(`UniFi schedule ${scheduleId} deleted via v2 API.`);
  }

  // ---------------------------------------------------------------------------
  // Visitor Management
  // ---------------------------------------------------------------------------

  /**
   * Fetch all visitors from UniFi Access.
   */
  async getVisitors(): Promise<UnifiVisitor[]> {
    // 1. Try Developer API v1
    try {
      const res = await this.http.get<UnifiApiResponse<any[]>>('/api/v1/developer/visitors');
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiVisitor(item));
      }
    } catch {
      // Fall through
    }

    // 2. Try Integration v1 via proxy
    try {
      const res = await this.http.get<UnifiApiResponse<any[]>>(
        '/proxy/access/integration/v1/developer/visitors'
      );
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiVisitor(item));
      }
    } catch {
      // Fall through
    }

    // 3. Try UniFi Access v2 API
    try {
      const res = await this.http.get<{
        code: number;
        data: any[];
      }>('/proxy/access/api/v2/visitors');
      if (Array.isArray(res.data?.data)) {
        return res.data.data.map((item) => normalizeUnifiVisitor(item));
      }
    } catch (err) {
      logger.warn(`UniFi getVisitors failed on all endpoints: ${err}`);
      throw err;
    }

    return [];
  }

  /**
   * Get a single visitor by ID.
   */
  async getVisitor(visitorId: string): Promise<UnifiVisitor> {
    try {
      const res = await this.http.get<UnifiApiResponse<any>>(
        `/api/v1/developer/visitors/${encodeURIComponent(visitorId)}`
      );
      if (res.data?.data) return normalizeUnifiVisitor(res.data.data);
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.get<UnifiApiResponse<any>>(
        `/proxy/access/integration/v1/developer/visitors/${encodeURIComponent(visitorId)}`
      );
      if (res.data?.data) return normalizeUnifiVisitor(res.data.data);
    } catch {
      // Fall through
    }

    const res = await this.http.get<{ code: number; data: any }>(
      `/proxy/access/api/v2/visitor/${encodeURIComponent(visitorId)}`
    );
    if (res.data?.data) return normalizeUnifiVisitor(res.data.data);
    throw new Error(`Visitor ${visitorId} not found in UniFi Access.`);
  }

  /**
   * Create a new visitor in UniFi Access.
   */
  async createVisitor(visitor: Partial<UnifiVisitor>): Promise<UnifiVisitor> {
    const payload = serializeUnifiVisitor(visitor);

    try {
      const res = await this.http.post<UnifiApiResponse<any>>(
        '/api/v1/developer/visitors',
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi visitor created via Developer API: ${res.data.data.id || visitor.first_name}`);
        return normalizeUnifiVisitor(res.data.data);
      }
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.post<UnifiApiResponse<any>>(
        '/proxy/access/integration/v1/developer/visitors',
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi visitor created via Integration API: ${res.data.data.id || visitor.first_name}`);
        return normalizeUnifiVisitor(res.data.data);
      }
    } catch {
      // Fall through
    }

    const res = await this.http.post<{ code: number; data: any }>(
      '/proxy/access/api/v2/visitors',
      payload
    );
    logger.info(`UniFi visitor created via v2 API: ${res.data?.data?.id || visitor.first_name}`);
    return normalizeUnifiVisitor(res.data?.data ?? payload);
  }

  /**
   * Update an existing visitor in UniFi Access.
   */
  async updateVisitor(visitorId: string, updates: Partial<UnifiVisitor>): Promise<UnifiVisitor> {
    const payload = serializeUnifiVisitor(updates);

    try {
      const res = await this.http.put<UnifiApiResponse<any>>(
        `/api/v1/developer/visitors/${encodeURIComponent(visitorId)}`,
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi visitor ${visitorId} updated via Developer API.`);
        return normalizeUnifiVisitor(res.data.data);
      }
      return normalizeUnifiVisitor({ id: visitorId, ...payload });
    } catch {
      // Fall through
    }

    try {
      const res = await this.http.put<UnifiApiResponse<any>>(
        `/proxy/access/integration/v1/developer/visitors/${encodeURIComponent(visitorId)}`,
        payload
      );
      if (res.data?.data) {
        logger.info(`UniFi visitor ${visitorId} updated via Integration API.`);
        return normalizeUnifiVisitor(res.data.data);
      }
      return normalizeUnifiVisitor({ id: visitorId, ...payload });
    } catch {
      // Fall through
    }

    const res = await this.http.put<{ code: number; data: any }>(
      `/proxy/access/api/v2/visitor/${encodeURIComponent(visitorId)}`,
      payload
    );
    logger.info(`UniFi visitor ${visitorId} updated via v2 API.`);
    return normalizeUnifiVisitor(res.data?.data ?? { id: visitorId, ...payload });
  }

  /**
   * Delete or revoke a visitor from UniFi Access.
   */
  async deleteVisitor(visitorId: string): Promise<void> {
    try {
      await this.http.delete(
        `/api/v1/developer/visitors/${encodeURIComponent(visitorId)}`
      );
      logger.info(`UniFi visitor ${visitorId} deleted via Developer API.`);
      return;
    } catch {
      // Fall through
    }

    try {
      await this.http.delete(
        `/proxy/access/integration/v1/developer/visitors/${encodeURIComponent(visitorId)}`
      );
      logger.info(`UniFi visitor ${visitorId} deleted via Integration API.`);
      return;
    } catch {
      // Fall through
    }

    await this.http.delete(
      `/proxy/access/api/v2/visitor/${encodeURIComponent(visitorId)}`
    );
    logger.info(`UniFi visitor ${visitorId} deleted via v2 API.`);
  }
}
