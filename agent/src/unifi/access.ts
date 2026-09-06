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
  schedule_id?: string | null;
  schedule_name?: string | null;
  unlock_schedule_id?: string | null;
  door_unlock_rule?: any;
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
  visit_reason?: 'Interview' | 'Business' | 'Cooperation' | 'Others' | string;
  sync_status?: 'synced' | 'pending' | 'error';
  sync_error?: string;
  raw_data?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export type AccessMethod =
  | 'nfc_card'       // Keycard, Key fob, NFC badge
  | 'pin_code'       // Keypad PIN
  | 'mobile_tap'     // UniFi Identity app (NFC / Bluetooth)
  | 'hand_wave'      // Wave to unlock sensor
  | 'remote'         // Admin / manual dashboard unlock
  | 'face'           // Face recognition
  | 'visitor_pin'    // Temporary visitor PIN / QR
  | 'schedule'       // Automated schedule unlock
  | 'unknown';

export interface AccessLogEntry {
  id: string;                      // UniFi system log event ID
  org_id?: string;
  timestamp: string;               // ISO 8601 string
  event_type: 'door_unlock' | 'door_open' | 'door_close' | 'access_denied' | string;
  event_result: 'success' | 'denied' | 'failed';
  door_id: string;
  door_label: string;
  user_id?: string;
  user_name?: string;
  user_type?: 'user' | 'visitor' | 'admin' | 'unknown';
  access_method: AccessMethod;
  access_method_label: string;     // e.g. "Key Card / Fob", "Keypad PIN", "Mobile Tap"
  display_message?: string;
  raw_data?: Record<string, unknown>;
}

export function normalizeUnifiVisitor(raw: any, orgId = ''): UnifiVisitor {
  const id = String(raw.id || raw.unique_id || raw.visitor_id || raw.user_id || raw._id || '');
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
  const rawDoors = raw.doors || raw.door_ids || raw.device_ids || raw.resources;
  if (Array.isArray(rawDoors)) {
    for (const d of rawDoors) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        const dId = d.id || d.unique_id || d.door_id;
        const dLabel = d.name || d.label;
        if (dId) doorIds.push(String(dId));
        if (dLabel) doorLabels.push(String(dLabel));
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
    purpose: raw.purpose || raw.note || raw.remarks || raw.visit_reason,
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
  // UniFi API visit_reason enum: 'Interview' | 'Business' | 'Cooperation' | 'Others'
  const rawReason = String(visitor.visit_reason || visitor.purpose || '').trim().toLowerCase();
  let normalizedReason = 'Others';
  if (rawReason === 'interview') normalizedReason = 'Interview';
  else if (rawReason === 'business') normalizedReason = 'Business';
  else if (rawReason === 'cooperation') normalizedReason = 'Cooperation';
  else normalizedReason = 'Others';

  base.visit_reason = normalizedReason;
  base.purpose = visitor.purpose || normalizedReason;

  if (visitor.door_ids && visitor.door_ids.length > 0) {
    base.doors = visitor.door_ids;
    base.door_ids = visitor.door_ids;
    base.resources = visitor.door_ids.map((id) => ({
      id,
      type: 'door',
    }));
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

  // Ensure last_name is present as it is required by UniFi Access API
  if (!base.last_name) {
    base.last_name = visitor.last_name || '.';
  }

  if (visitor.pin_code) {
    base.pin_code = String(visitor.pin_code);
    base.pin = String(visitor.pin_code);
  }

  return base;
}

export function normalizeAccessLogEntry(raw: any, orgId = ''): AccessLogEntry {
  const id = String(raw.id || raw._id || raw.event_id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  // Parse timestamp (supports Developer API @timestamp string and epoch numbers)
  let timestampIso = new Date().toISOString();
  const rawTs = raw['@timestamp'] || raw.timestamp || raw.event_time || raw.created_at || raw.published;
  if (rawTs) {
    if (typeof rawTs === 'number') {
      timestampIso = new Date(rawTs > 10000000000 ? rawTs : rawTs * 1000).toISOString();
    } else {
      const parsed = new Date(rawTs).getTime();
      if (!isNaN(parsed)) timestampIso = new Date(parsed).toISOString();
    }
  }

  const source = raw._source || raw.source || raw;
  const event = source.event || raw.event || {};
  const actor = source.actor || raw.actor || raw.user || {};
  const auth = source.authentication || raw.authentication || {};
  const rawTarget = source.target || raw.target || raw.door || {};
  const target = Array.isArray(rawTarget)
    ? (rawTarget.find((t: any) => t?.type === 'door') || rawTarget[0] || {})
    : rawTarget;

  // Event Type
  const rawEventType = String(event.type || raw.event_type || raw.type || '').toLowerCase();
  let eventType: 'door_unlock' | 'door_open' | 'door_close' | 'access_denied' | string = 'door_unlock';
  if (rawEventType.includes('door.open') || rawEventType.includes('dps.open') || rawEventType.includes('open')) {
    eventType = 'door_open';
  } else if (rawEventType.includes('door.close') || rawEventType.includes('dps.close') || rawEventType.includes('close')) {
    eventType = 'door_close';
  } else if (rawEventType.includes('reject') || rawEventType.includes('denied') || rawEventType.includes('failed')) {
    eventType = 'access_denied';
  } else if (rawEventType.includes('unlock')) {
    eventType = 'door_unlock';
  }

  // Result
  const rawResult = String(event.result || raw.result || '').toUpperCase();
  const eventResult: 'success' | 'denied' | 'failed' =
    rawResult.includes('DENIED') || rawResult.includes('REJECT') || eventType === 'access_denied'
      ? 'denied'
      : rawResult.includes('FAIL')
      ? 'failed'
      : 'success';

  // Access Method
  const rawMethod = String(
    auth.credential_provider ||
    raw.credential_type ||
    raw.method ||
    raw.access_method ||
    event.type ||
    ''
  ).toLowerCase();

  let accessMethod: AccessMethod = 'unknown';
  let accessMethodLabel = 'Access Method';

  if (rawMethod.includes('card') || rawMethod.includes('nfc') || rawMethod.includes('rfid') || rawMethod.includes('fob')) {
    accessMethod = 'nfc_card';
    accessMethodLabel = 'Key Card / Fob';
  } else if (rawMethod.includes('pin') || rawMethod.includes('passcode') || rawMethod.includes('password')) {
    accessMethod = 'pin_code';
    accessMethodLabel = 'Keypad PIN';
  } else if (rawMethod.includes('mobile') || rawMethod.includes('bluetooth') || rawMethod.includes('bt') || rawMethod.includes('app')) {
    accessMethod = 'mobile_tap';
    accessMethodLabel = 'Mobile Tap';
  } else if (rawMethod.includes('wave') || rawMethod.includes('hand')) {
    accessMethod = 'hand_wave';
    accessMethodLabel = 'Hand Wave';
  } else if (rawMethod.includes('remote') || rawMethod.includes('manual') || rawMethod.includes('button')) {
    accessMethod = 'remote';
    accessMethodLabel = 'Remote Unlock';
  } else if (rawMethod.includes('face')) {
    accessMethod = 'face';
    accessMethodLabel = 'Face Recognition';
  } else if (rawMethod.includes('visitor') || rawMethod.includes('qr')) {
    accessMethod = 'visitor_pin';
    accessMethodLabel = 'Visitor PIN / QR';
  } else if (rawMethod.includes('schedule')) {
    accessMethod = 'schedule';
    accessMethodLabel = 'Schedule';
  }

  // User details
  const userName = String(
    actor.display_name ||
    actor.name ||
    actor.full_name ||
    raw.user_name ||
    (actor.id ? `User ${actor.id}` : 'Unknown User')
  ).trim();

  const userId = actor.id ? String(actor.id) : (raw.user_id ? String(raw.user_id) : undefined);
  const userType: 'user' | 'visitor' | 'admin' | 'unknown' =
    actor.type === 'visitor' ? 'visitor' : actor.type === 'admin' ? 'admin' : actor.type === 'user' ? 'user' : 'unknown';

  // Door details
  const doorId = String(target.id || raw.door_id || raw.unique_id || '');
  const doorLabel = String(target.display_name || target.name || raw.door_label || raw.door_name || 'Door');

  // Display message
  const displayMessage =
    event.display_message ||
    raw.display_message ||
    (eventType === 'door_open'
      ? `${doorLabel} opened`
      : eventType === 'door_close'
      ? `${doorLabel} closed`
      : eventResult === 'denied'
      ? `Access denied for ${userName} at ${doorLabel} (${accessMethodLabel})`
      : `${userName} opened ${doorLabel} via ${accessMethodLabel}`);

  return {
    id,
    org_id: orgId,
    timestamp: timestampIso,
    event_type: eventType,
    event_result: eventResult,
    door_id: doorId,
    door_label: doorLabel,
    user_id: userId,
    user_name: userName,
    user_type: userType,
    access_method: accessMethod,
    access_method_label: accessMethodLabel,
    display_message: displayMessage,
    raw_data: raw,
  };
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

const DAY_ALIASES: Record<string, DayOfWeek> = {
  monday: 'monday',
  mon: 'monday',
  mo: 'monday',
  '1': 'monday',
  tuesday: 'tuesday',
  tue: 'tuesday',
  tu: 'tuesday',
  '2': 'tuesday',
  wednesday: 'wednesday',
  wed: 'wednesday',
  we: 'wednesday',
  '3': 'wednesday',
  thursday: 'thursday',
  thu: 'thursday',
  th: 'thursday',
  '4': 'thursday',
  friday: 'friday',
  fri: 'friday',
  fr: 'friday',
  '5': 'friday',
  saturday: 'saturday',
  sat: 'saturday',
  sa: 'saturday',
  '6': 'saturday',
  sunday: 'sunday',
  sun: 'sunday',
  su: 'sunday',
  '7': 'sunday',
  '0': 'sunday',
};

export function parseDayOfWeek(raw: any): DayOfWeek | undefined {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).toLowerCase().trim();
  return DAY_ALIASES[str];
}

export function parseTimeHHMM(rawTime: any, defaultVal = '08:00'): string {
  if (rawTime === undefined || rawTime === null || rawTime === '') return defaultVal;

  // Numeric seconds from midnight e.g. 28800 -> "08:00"
  if (typeof rawTime === 'number') {
    const totalMinutes = Math.floor(rawTime / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  const str = String(rawTime).trim();
  if (!str) return defaultVal;

  // String purely numeric seconds e.g. "28800"
  if (/^\d{4,6}$/.test(str)) {
    const num = parseInt(str, 10);
    const totalMinutes = Math.floor(num / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // Extract HH:MM from "HH:MM:SS" or "H:M"
  const parts = str.split(':');
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return defaultVal;
}

export function normalizeUnifiSchedule(raw: any, orgId = ''): UnifiSchedule {
  const id = String(raw.id || raw.unique_id || raw._id || raw.schedule_id || '');
  const name = String(raw.name || raw.schedule_name || raw.alias || raw.title || 'Schedule');
  const type = raw.type || (raw.is_unlock ? 'unlock' : 'access');
  const isDefault = Boolean(raw.is_default || raw.default);
  const holidayGroupId = raw.holiday_group_id || raw.holiday_id;

  const weeklySchedule: UnifiWeeklyScheduleDay[] = DAYS_OF_WEEK.map((day) => ({
    day,
    active: false,
    slots: [],
  }));

  const rawWeekly =
    raw.weekly_schedule ||
    raw.week_schedule ||
    raw.schedule ||
    raw.schedules ||
    raw.work_time_rule ||
    raw.door_unlock_rule ||
    raw.rules;

  if (Array.isArray(rawWeekly)) {
    for (const item of rawWeekly) {
      const targetDay =
        parseDayOfWeek(item.day) ||
        parseDayOfWeek(item.day_of_week) ||
        (typeof item.day_of_week === 'number' ? DAYS_OF_WEEK[item.day_of_week === 0 ? 6 : item.day_of_week - 1] : undefined);

      if (targetDay) {
        const dayEntry = weeklySchedule.find((w) => w.day === targetDay);
        if (dayEntry) {
          const rawSlots =
            item.slots ||
            item.time_slots ||
            item.intervals ||
            item.periods ||
            item.ranges ||
            item.times;

          if (Array.isArray(rawSlots) && rawSlots.length > 0) {
            dayEntry.active = item.active !== false;
            for (const s of rawSlots) {
              const start = parseTimeHHMM(s.start_time || s.start || s.from || s.start_at, '08:00');
              const end = parseTimeHHMM(s.end_time || s.end || s.to || s.end_at, '17:00');
              dayEntry.slots.push({ start_time: start, end_time: end });
            }
          } else if (item.start_time || item.start || item.from) {
            dayEntry.active = item.active !== false;
            dayEntry.slots.push({
              start_time: parseTimeHHMM(item.start_time || item.start || item.from, '08:00'),
              end_time: parseTimeHHMM(item.end_time || item.end || item.to, '17:00'),
            });
          }
        }
      }
    }
  } else if (rawWeekly && typeof rawWeekly === 'object') {
    for (const [dayKey, dayData] of Object.entries(rawWeekly)) {
      const targetDay = parseDayOfWeek(dayKey);
      if (!targetDay) continue;

      const dayEntry = weeklySchedule.find((w) => w.day === targetDay);
      if (dayEntry && dayData) {
        if (Array.isArray(dayData) && dayData.length > 0) {
          dayEntry.active = true;
          for (const s of dayData) {
            if (s && typeof s === 'object') {
              const start = parseTimeHHMM(s.start_time || s.start || s.from, '08:00');
              const end = parseTimeHHMM(s.end_time || s.end || s.to, '17:00');
              dayEntry.slots.push({ start_time: start, end_time: end });
            }
          }
        } else if (typeof dayData === 'object' && ((dayData as any).start_time || (dayData as any).start || (dayData as any).slots)) {
          const dObj = dayData as any;
          dayEntry.active = dObj.active !== false;
          if (Array.isArray(dObj.slots) && dObj.slots.length > 0) {
            for (const s of dObj.slots) {
              dayEntry.slots.push({
                start_time: parseTimeHHMM(s.start_time || s.start, '08:00'),
                end_time: parseTimeHHMM(s.end_time || s.end, '17:00'),
              });
            }
          } else {
            dayEntry.slots.push({
              start_time: parseTimeHHMM(dObj.start_time || dObj.start, '08:00'),
              end_time: parseTimeHHMM(dObj.end_time || dObj.end, '17:00'),
            });
          }
        }
      }
    }
  }

  // Deduplicate and ensure active days with 0 slots get marked inactive
  for (const day of weeklySchedule) {
    if (day.slots.length === 0) {
      day.active = false;
    }
  }

  const doorIds: string[] = [];
  const doorLabels: string[] = [];
  const rawDoors = raw.doors || raw.door_ids || raw.device_ids || raw.resources;
  if (Array.isArray(rawDoors)) {
    for (const d of rawDoors) {
      if (typeof d === 'string') {
        doorIds.push(d);
      } else if (d && typeof d === 'object') {
        const dId = d.id || d.unique_id || d.door_id;
        const dName = d.name || d.label || d.door_name;
        if (dId) doorIds.push(String(dId));
        if (dName) doorLabels.push(String(dName));
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

function formatTimeHHMMSS(t: string, defaultSec = '00'): string {
  if (!t) return `00:00:${defaultSec}`;
  const parts = t.split(':');
  if (parts.length === 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${defaultSec}`;
  }
  if (parts.length >= 3) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  }
  return t;
}

export function serializeUnifiSchedule(schedule: Partial<UnifiSchedule>): any {
  const base: Record<string, any> = schedule.raw_data ? { ...schedule.raw_data } : {};

  if (schedule.name) base.name = schedule.name;
  if (schedule.type) base.type = schedule.type;
  if (schedule.holiday_group_id !== undefined) base.holiday_group_id = schedule.holiday_group_id;

  if (schedule.weekly_schedule) {
    base.weekly_schedule = schedule.weekly_schedule.map((dayObj, idx) => {
      const activeSlots = dayObj.active
        ? dayObj.slots.map((s) => ({
            start_time: parseTimeHHMM(s.start_time, '08:00'),
            end_time: parseTimeHHMM(s.end_time, '17:00'),
          }))
        : [];
      return {
        day: dayObj.day,
        day_of_week: idx + 1,
        active: dayObj.active && activeSlots.length > 0,
        slots: activeSlots,
        time_slots: activeSlots,
      };
    });

    const weekScheduleObj: Record<string, any[]> = {};
    for (const d of schedule.weekly_schedule) {
      const formattedSlots = d.active
        ? d.slots.map((s) => ({
            start_time: formatTimeHHMMSS(s.start_time, '00'),
            end_time: formatTimeHHMMSS(s.end_time, '59'),
          }))
        : [];
      weekScheduleObj[d.day] = formattedSlots;
      weekScheduleObj[d.day.slice(0, 3)] = formattedSlots;
    }
    base.week_schedule = weekScheduleObj;
  }

  if (schedule.door_ids) {
    base.door_ids = schedule.door_ids;
    base.doors = schedule.door_ids;
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
  /** Latest raw device list from the v2 devices API, used for hub validation in unlockDoor */
  private deviceCache: any[] = [];

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
        logger.debug(
          `UniFi API error: ${error.config?.method?.toUpperCase()} ${error.config?.url} -> ${error.response?.status ?? error.message}`
        );
        return Promise.reject(error);
      }
    );
  }

  /**
   * Populate internal mapping of door IDs to device/hub IDs from:
   * 1. v2 topology tree (/proxy/access/api/v2/devices/topology)
   * 2. v2 devices API (/proxy/access/api/v2/devices)
   * 3. v2 doors API (/proxy/access/api/v2/doors)
   */
  private async populateDoorToHubMap(): Promise<void> {
    // Strategy 1: UniFi Access topology API (explicit door -> hub relationship)
    try {
      const topoRes = await this.http.get<{
        data?: Array<any>;
      }>('/proxy/access/api/v2/devices/topology');
      const topoData = topoRes.data?.data || [];

      const walkTopology = (item: any) => {
        if (!item) return;
        if (Array.isArray(item)) {
          for (const el of item) walkTopology(el);
          return;
        }
        if (Array.isArray(item.doors)) {
          for (const door of item.doors) {
            const doorId = door.id || door.unique_id;
            if (doorId && Array.isArray(door.device_groups)) {
              for (const group of door.device_groups) {
                const devs = Array.isArray(group) ? group : (group.devices || [group]);
                for (const dev of devs) {
                  if (isHubDevice(dev) && dev.unique_id) {
                    this.doorToHubMap.set(doorId, dev.unique_id);
                    logger.info(
                      `[UniFi] Mapped Hub ${dev.unique_id} (${dev.device_type || 'hub'}) to door ${doorId} via topology`
                    );
                  }
                }
              }
            }
          }
        }
        if (Array.isArray(item.floors)) {
          walkTopology(item.floors);
        }
      };

      walkTopology(topoData);
    } catch (err: any) {
      logger.debug(`[UniFi] Topology fetch not available or failed: ${err.message}`);
    }

    // Strategy 2: v2 devices API
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
            }
          }
        }
      }

      // Pass 2: Hubs with d.doors or d.relays
      for (const d of devices) {
        if (isHubDevice(d)) {
          if (Array.isArray(d.doors)) {
            for (const dr of d.doors) {
              const dId = typeof dr === 'string' ? dr : (dr?.unique_id || dr?.id);
              if (dId && !this.doorToHubMap.has(dId)) {
                this.doorToHubMap.set(dId, d.unique_id);
                logger.info(`[UniFi] Mapped Hub ${d.unique_id} to door ${dId} from hub.doors`);
              }
            }
          }
          if (Array.isArray(d.relays)) {
            for (const r of d.relays) {
              const dId = r.door_id || r.target_door_id || r.target_id;
              if (dId && !this.doorToHubMap.has(dId)) {
                this.doorToHubMap.set(dId, d.unique_id);
                logger.info(`[UniFi] Mapped Hub ${d.unique_id} to door ${dId} from hub.relays`);
              }
            }
          }
        }
      }

      // Pass 3: Hubs with d.door or location_id
      for (const d of devices) {
        const doorId = d.door?.unique_id || d.location_id;
        if (doorId && isHubDevice(d) && !this.doorToHubMap.has(doorId)) {
          this.doorToHubMap.set(doorId, d.unique_id);
          this.doorToPortMap.set(doorId, 'd1');
          logger.info(`[UniFi] Mapped Hub ${d.unique_id} to door ${doorId} (${d.door?.name || d.name || 'Door'})`);
        }
      }

      // Pass 4: Readers with linked hub ID attributes
      for (const d of devices) {
        const doorId = d.door?.unique_id || d.location_id;
        const linkedHubId =
          d.connected_uah_id ||
          d.hub_id ||
          d.connected_hub_id ||
          d.parent_device_id ||
          d.door?.hub_id ||
          d.door?.device_id ||
          d.door?.uah_id;
        if (doorId && linkedHubId && !this.doorToHubMap.has(doorId)) {
          this.doorToHubMap.set(doorId, linkedHubId);
          logger.info(`[UniFi] Mapped Hub ${linkedHubId} (from device ${d.unique_id}) to door ${doorId}`);
        }
      }

      // Pass 5: Single Hub fallback (e.g. site with one Retrofit Hub)
      const allHubs = devices.filter((d) => isHubDevice(d));
      if (allHubs.length === 1) {
        const singleHub = allHubs[0];
        for (const d of devices) {
          const doorId = d.door?.unique_id;
          if (doorId && !this.doorToHubMap.has(doorId)) {
            this.doorToHubMap.set(doorId, singleHub.unique_id);
            logger.info(
              `[UniFi] Single hub ${singleHub.unique_id} mapped as default for door ${doorId}`
            );
          }
        }
      }
    } catch (err: any) {
      logger.debug(`[UniFi] Failed to populate door to hub map from devices: ${err.message}`);
    }

    // Strategy 3: v2 doors API
    try {
      const doorsRes = await this.http.get<{
        data?: Array<any>;
      }>('/proxy/access/api/v2/doors');
      const doorsData = doorsRes.data?.data || [];
      for (const dr of doorsData) {
        const doorId = dr.id || dr.unique_id;
        const hubId = dr.hub_id || dr.connected_uah_id || dr.uah_id || dr.device_id;
        if (doorId && hubId && !this.doorToHubMap.has(doorId)) {
          this.doorToHubMap.set(doorId, hubId);
          logger.info(`[UniFi] Mapped Hub ${hubId} to door ${doorId} via /doors`);
        }
      }
    } catch {}
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
    const candidateEndpoints = this.getDeveloperEndpoints('doors');
    for (const ep of candidateEndpoints) {
      try {
        const response = await this.http.get<UnifiApiResponse<UnifiDoor[]>>(ep);
        if (Array.isArray(response.data?.data)) {
          // Asynchronously populate door-to-hub mapping in background
          this.populateDoorToHubMap().catch(() => {});
          return response.data.data;
        }
      } catch {
        // Fall through
      }
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
    // Cache raw device list for use in unlockDoor hub validation
    this.deviceCache = devices;

    // Ensure doorToHubMap and doorToPortMap are populated
    // Pass A: Multi-port hub extensions (highest priority — explicit port→door mapping)
    for (const d of devices) {
      if (d.extensions && Array.isArray(d.extensions)) {
        for (const ext of d.extensions) {
          if (ext.target_type === 'door' && ext.target_value) {
            const port = ext.source_id === 'port2' ? 'd2' : 'd1';
            this.doorToHubMap.set(ext.target_value, d.unique_id);
            this.doorToPortMap.set(ext.target_value, port);
            logger.debug(`[UniFi] getDoors: extension mapped door ${ext.target_value} -> hub ${d.unique_id} port ${port}`);
          }
        }
      }
    }
    // Pass B: Hub devices with d.door or d.location_id (only if not already set)
    for (const d of devices) {
      const doorId = d.door?.unique_id || d.location_id;
      if (doorId && isHubDevice(d) && !this.doorToHubMap.has(doorId)) {
        this.doorToHubMap.set(doorId, d.unique_id);
        this.doorToPortMap.set(doorId, 'd1');
        logger.debug(`[UniFi] getDoors: hub location mapped door ${doorId} -> hub ${d.unique_id}`);
      }
    }
    // Pass C: Readers with connected_uah_id — only fill gaps (never overwrite extension mappings)
    for (const d of devices) {
      const doorId = d.door?.unique_id || d.location_id;
      const linkedHubId = d.connected_uah_id || d.hub_id || d.connected_hub_id;
      if (doorId && linkedHubId && !this.doorToHubMap.has(doorId)) {
        this.doorToHubMap.set(doorId, linkedHubId);
        logger.debug(`[UniFi] getDoors: connected_uah_id mapped door ${doorId} -> hub ${linkedHubId} (from device ${d.unique_id})`);
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
            type: hub?.device_type || (isHub ? d.device_type : d.device_type),
            location_id: d.door.up_id || '',
            full_name: d.door.full_name || d.door.name,
            device_state: hub?.device_state || d.device_state || d.state || 'connected',
          });
        } else {
          // If already in doorMap (from hub extensions), prefer official name from reader/door if cleaner
          if (d.door.name) {
            existing.name = d.door.name;
          }
          if (d.door.full_name) {
            existing.full_name = d.door.full_name;
          }
          if (hub?.device_type) {
            existing.type = hub.device_type;
          }
          existing.door_lock_relay_status = status.relayStatus;
          existing.door_position_status = status.positionStatus;
          existing.is_held_unlocked = status.isHeld;
        }
      }
    }

    // Pass 3: Enrich doors with schedules/rules from v2 doors, locations, and door_unlock_rules API
    try {
      const endpoints = [
        '/proxy/access/api/v2/doors',
        '/proxy/access/api/v2/locations',
        '/proxy/access/api/v2/door_unlock_rules',
        '/proxy/access/api/v2/settings/door_unlock_rules',
      ];
      for (const ep of endpoints) {
        try {
          const res = await this.http.get<{ data?: any }>(ep);
          const list = Array.isArray(res.data?.data)
            ? res.data.data
            : Array.isArray(res.data?.data?.list)
            ? res.data.data.list
            : Array.isArray(res.data)
            ? res.data
            : [];
          for (const dr of list) {
            if (!dr || typeof dr !== 'object') continue;
            const doorId = String(dr.id || dr.unique_id || dr.door_id || dr.location_id || '');
            if (!doorId) continue;
            const existing = doorMap.get(doorId);
            const schedId = dr.unlock_schedule_id || dr.schedule_id || dr.door_unlock_rule?.schedule_id || dr.door_unlock_rule?.id || dr.keep_open_schedule_id;
            const schedName = dr.unlock_schedule?.name || dr.schedule?.name || dr.door_unlock_rule?.name || dr.door_unlock_rule?.schedule_name || dr.keep_open_schedule?.name;
            if (existing) {
              if (schedId && !existing.schedule_id) existing.schedule_id = String(schedId);
              if (schedName && !existing.schedule_name) existing.schedule_name = String(schedName);
              if (dr.door_unlock_rule && !existing.door_unlock_rule) existing.door_unlock_rule = dr.door_unlock_rule;
            } else if (dr.type === 'door' || ep.includes('doors') || ep.includes('locations')) {
              doorMap.set(doorId, {
                id: doorId,
                name: dr.name || dr.full_name || doorId,
                door_lock_relay_status: (dr.door_lock_relay_status === 'unlock' ? 'unlock' : 'lock'),
                door_position_status: dr.door_position_status ?? undefined,
                type: dr.type || 'door',
                full_name: dr.full_name || dr.name,
                device_state: dr.device_state || 'connected',
                schedule_id: schedId ? String(schedId) : undefined,
                schedule_name: schedName ? String(schedName) : undefined,
                door_unlock_rule: dr.door_unlock_rule,
              });
            }
          }
        } catch {}
      }
    } catch {}

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
   * Performs an immediate unlock (via UniFi OS v2 native dashboard location or hub relay)
   * and optionally applies a hold-open lock rule for the requested duration.
   *
   * @param doorId      - UniFi door ID
   * @param durationMin - How long to hold the door unlocked, in minutes (if supported)
   */
  async unlockDoor(doorId: string, durationMin: number = 0): Promise<void> {
    let unlocked = false;
    let lastError: Error | null = null;

    let hubId = this.doorToHubMap.get(doorId);
    let port = this.doorToPortMap.get(doorId) || 'd1';
    if (!hubId) {
      await this.populateDoorToHubMap().catch(() => {});
      hubId = this.doorToHubMap.get(doorId);
      port = this.doorToPortMap.get(doorId) || 'd1';
    }

    // Validate that hubId is actually a hub device, not a reader.
    // This guards against the hub map being populated with a reader's device ID
    // (e.g. when a Retrofit Reader's connected_uah_id overwrites extension mappings).
    if (hubId) {
      const deviceList = this.deviceCache.length > 0 ? this.deviceCache : [];
      const hubDevice = deviceList.find((d: any) => d.unique_id === hubId);
      if (hubDevice && isReaderDevice(hubDevice)) {
        // The stored 'hub' is actually a reader — look up its parent hub
        const actualHubId = hubDevice.connected_uah_id || hubDevice.hub_id || hubDevice.connected_hub_id;
        logger.warn(
          `[UniFi] unlockDoor: hubId ${hubId} is a reader (${hubDevice.device_type}), ` +
          `resolving to actual hub via connected_uah_id: ${actualHubId || 'not found'}`
        );
        if (actualHubId) {
          hubId = actualHubId;
          this.doorToHubMap.set(doorId, actualHubId); // fix the map for future calls
        } else {
          // No parent hub found — clear hubId so we fall through to other strategies
          hubId = undefined;
        }
      }
      logger.debug(`[UniFi] unlockDoor: door=${doorId} hubId=${hubId} port=${port}`);
    } else {
      logger.warn(`[UniFi] unlockDoor: no hub found for door ${doorId} — will try direct endpoints only`);
    }

    const attempts: Array<{ name: string; fn: () => Promise<any> }> = [];
    const durationSeconds = durationMin > 0 ? durationMin * 60 : 5;

    // 1. Primary: Official Developer API door unlock endpoints (dedicated port 12445 + proxy)
    const devUnlockEndpoints = this.getDeveloperEndpoints('doors', `${encodeURIComponent(doorId)}/unlock`);
    for (const ep of devUnlockEndpoints) {
      attempts.push({
        name: `PUT ${ep} { duration: ${durationSeconds} }`,
        fn: () => this.http.put(ep, { duration: durationSeconds }),
      });
      attempts.push({
        name: `PUT ${ep} {}`,
        fn: () => this.http.put(ep, {}),
      });
      attempts.push({
        name: `POST ${ep} { duration: ${durationSeconds} }`,
        fn: () => this.http.post(ep, { duration: durationSeconds }),
      });
      attempts.push({
        name: `POST ${ep} {}`,
        fn: () => this.http.post(ep, {}),
      });
    }

    // 1b. Developer API direct door state change
    const devDoorEndpoints = this.getDeveloperEndpoints('doors', encodeURIComponent(doorId));
    for (const ep of devDoorEndpoints) {
      attempts.push({
        name: `PUT ${ep} { door_lock_relay_status: 'unlock' }`,
        fn: () => this.http.put(ep, { door_lock_relay_status: 'unlock' }),
      });
    }

    // 2. Physical Hub relay_unlock (UniFi OS Access v2 hardware controller & Retrofit Hub)
    if (hubId) {
      const hubEndpoints = [
        `/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/relay_unlock`,
        `/proxy/access/api/v2/devices/${encodeURIComponent(hubId)}/relay_unlock`,
      ];
      for (const ep of hubEndpoints) {
        // Multi-port specific payloads (d1 vs d2 on Retrofit Hub 2)
        attempts.push({
          name: `PUT ${ep} (port: ${port}, door_id: ${doorId})`,
          fn: () => this.http.put(ep, { port, door_id: doorId, duration: durationSeconds }),
        });
        attempts.push({
          name: `POST ${ep} (port: ${port}, door_id: ${doorId})`,
          fn: () => this.http.post(ep, { port, door_id: doorId, duration: durationSeconds }),
        });
        attempts.push({
          name: `PUT ${ep} (door_id: ${doorId})`,
          fn: () => this.http.put(ep, { door_id: doorId }),
        });
        attempts.push({
          name: `POST ${ep} (door_id: ${doorId})`,
          fn: () => this.http.post(ep, { door_id: doorId }),
        });
        attempts.push({
          name: `PUT ${ep} {}`,
          fn: () => this.http.put(ep, {}),
        });
      }
    }

    // 3. Fallback: try doorId directly as device ID relay_unlock
    attempts.push({
      name: `PUT /proxy/access/api/v2/device/${doorId}/relay_unlock`,
      fn: () =>
        this.http.put(
          `/proxy/access/api/v2/device/${encodeURIComponent(doorId)}/relay_unlock`,
          {}
        ),
    });
    attempts.push({
      name: `POST /proxy/access/api/v2/device/${doorId}/relay_unlock`,
      fn: () =>
        this.http.post(
          `/proxy/access/api/v2/device/${encodeURIComponent(doorId)}/relay_unlock`,
          {}
        ),
    });

    // 4. UniFi OS Access v2 dashboard locations unlock (door-level)
    const locationEndpoints = [
      `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}/unlock`,
      `/proxy/access/api/v2/locations/${encodeURIComponent(doorId)}/unlock`,
      `/proxy/access/api/v2/doors/${encodeURIComponent(doorId)}/unlock`,
      `/proxy/access/api/v2/door/${encodeURIComponent(doorId)}/unlock`,
    ];
    for (const ep of locationEndpoints) {
      attempts.push({
        name: `PUT ${ep}`,
        fn: () => this.http.put(ep, { duration: durationSeconds }),
      });
      attempts.push({
        name: `POST ${ep}`,
        fn: () => this.http.post(ep, { duration: durationSeconds }),
      });
    }

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

    // 5. Apply temporary hold-open lock rule if duration was specified
    if (durationMin > 0) {
      const holdRulePayloads: LockRulePayload[] = [
        { type: 'custom', interval: durationMin },
        { type: 'keep_unlock' as any },
      ];

      let holdRuleApplied = false;
      const holdEndpoints: string[] = [
        ...this.getDeveloperEndpoints('doors', `${encodeURIComponent(doorId)}/lock_rule`),
        `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}/lock_rule`,
        `/proxy/access/api/v2/locations/${encodeURIComponent(doorId)}/lock_rule`,
        `/proxy/access/api/v2/doors/${encodeURIComponent(doorId)}/lock_rule`,
      ];
      if (hubId) {
        holdEndpoints.push(`/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`);
        holdEndpoints.push(`/proxy/access/api/v2/devices/${encodeURIComponent(hubId)}/lock_rule`);
      }
      holdEndpoints.push(
        `/proxy/access/api/v2/device/${encodeURIComponent(doorId)}/lock_rule`
      );

      // Also try location unlock with full duration
      try {
        await this.http.put(
          `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}/unlock`,
          { duration: durationMin * 60 }
        );
        holdRuleApplied = true;
        unlocked = true;
        logger.info(
          `[UniFi] Door ${doorId} hold rule applied via dashboard location unlock (${durationMin} min)`
        );
      } catch {}

      if (!holdRuleApplied) {
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
    let port = this.doorToPortMap.get(doorId) || 'd1';
    if (!hubId) {
      await this.populateDoorToHubMap().catch(() => {});
      hubId = this.doorToHubMap.get(doorId);
      port = this.doorToPortMap.get(doorId) || 'd1';
    }

    // 1. Try developer lock endpoints (ports 12445 and 443)
    const devLockEndpoints = this.getDeveloperEndpoints('doors', `${encodeURIComponent(doorId)}/lock`);
    for (const ep of devLockEndpoints) {
      try {
        await this.http.put(ep, {});
        locked = true;
        logger.info(`[UniFi] Door ${doorId} locked via ${ep}`);
        return;
      } catch (err: any) {
        lastError = err;
      }
      try {
        await this.http.post(ep, {});
        locked = true;
        logger.info(`[UniFi] Door ${doorId} locked via ${ep}`);
        return;
      } catch (err: any) {
        lastError = err;
      }
    }

    // 1b. Direct door state change to lock
    const devDoorEndpoints = this.getDeveloperEndpoints('doors', encodeURIComponent(doorId));
    for (const ep of devDoorEndpoints) {
      try {
        await this.http.put(ep, { door_lock_relay_status: 'lock' });
        locked = true;
        logger.info(`[UniFi] Door ${doorId} locked via state update on ${ep}`);
        return;
      } catch (err: any) {
        lastError = err;
      }
    }

    // 2. Try native dashboard location lock
    try {
      await this.http.put(
        `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}/lock`,
        {}
      );
      locked = true;
      logger.info(`[UniFi] Door ${doorId} locked via dashboard locations lock`);
      return;
    } catch (err: any) {
      lastError = err;
      logger.debug(`[UniFi] Dashboard location lock failed: ${err.message}`);
    }

    const resetPayloads = [
      { type: 'reset' },
      { type: 'lock_early' },
      { type: 'keep_lock' },
    ];

    const lockEndpoints: string[] = [
      ...this.getDeveloperEndpoints('doors', `${encodeURIComponent(doorId)}/lock_rule`),
    ];
    if (hubId) {
      lockEndpoints.push(
        `/proxy/access/api/v2/device/${encodeURIComponent(hubId)}/lock_rule`,
        `/proxy/access/api/v2/devices/${encodeURIComponent(hubId)}/lock_rule`
      );
    }
    lockEndpoints.push(
      `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}/lock_rule`,
      `/proxy/access/api/v2/locations/${encodeURIComponent(doorId)}/lock_rule`,
      `/proxy/access/api/v2/device/${encodeURIComponent(doorId)}/lock_rule`,
      `/proxy/access/api/v2/devices/${encodeURIComponent(doorId)}/lock_rule`,
      `/proxy/access/api/v2/doors/${encodeURIComponent(doorId)}/lock_rule`
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
   * Discovers global schedules, access policy door assignments, door unlock rules, and
   * individual door-level unlock schedules.
   */
  async getSchedules(): Promise<UnifiSchedule[]> {
    const schedulesMap = new Map<string, UnifiSchedule>();

    // 1. Fetch from Developer API candidate endpoints (port 12445 & proxy endpoints)
    const scheduleEndpoints = this.getScheduleEndpoints();
    for (const endpoint of scheduleEndpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const rawList = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.list)
          ? res.data.data.list
          : Array.isArray(res.data?.list)
          ? res.data.list
          : Array.isArray(res.data)
          ? res.data
          : null;
        if (rawList && rawList.length > 0) {
          let added = 0;
          for (const item of rawList) {
            const sched = normalizeUnifiSchedule(item);
            if (sched.id) {
              schedulesMap.set(sched.id, sched);
              added++;
            }
          }
          if (added > 0) {
            logger.info(`[UniFi] Fetched ${added} schedule(s) via ${endpoint}`);
          }
        }
      } catch {}
    }

    // 2. Query v2 API schedules to merge
    try {
      const res = await this.http.get<{ code?: number; data?: any[] }>('/proxy/access/api/v2/schedules');
      const v2List = Array.isArray(res.data?.data) ? res.data.data : [];
      for (const item of v2List) {
        const sched = normalizeUnifiSchedule(item);
        if (sched.id && !schedulesMap.has(sched.id)) {
          schedulesMap.set(sched.id, sched);
        }
      }
    } catch {}

    // 2b. Query dedicated v2 door unlock rules & location schedules
    const doorRuleEndpoints = [
      '/proxy/access/api/v2/door_unlock_rules',
      '/proxy/access/api/v2/settings/door_unlock_rules',
      '/proxy/access/api/v2/locations',
      '/proxy/access/api/v2/dashboard/locations',
    ];
    for (const ep of doorRuleEndpoints) {
      try {
        const res = await this.http.get<any>(ep);
        const list = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.list)
          ? res.data.data.list
          : Array.isArray(res.data)
          ? res.data
          : [];
        for (const item of list) {
          if (!item) continue;
          const schedId = String(item.id || item.unique_id || item.schedule_id || '');
          if (schedId && !schedulesMap.has(schedId)) {
            const sched = normalizeUnifiSchedule({
              ...item,
              type: 'unlock',
            });
            if (sched.id) schedulesMap.set(sched.id, sched);
          }
        }
      } catch {}
    }

    // 3. Fetch Access Policies to map schedules to door assignments
    const scheduleToDoors = new Map<string, { doorIds: string[]; doorLabels: string[] }>();
    const policyEndpoints = [...this.getAccessPolicyEndpoints(), '/proxy/access/api/v2/policies'];
    for (const endpoint of policyEndpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const rawPolicies = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.list)
          ? res.data.data.list
          : Array.isArray(res.data)
          ? res.data
          : [];
        if (rawPolicies.length > 0) {
          for (const pol of rawPolicies) {
            const schedId = pol.schedule_id || pol.scheduleId;
            if (!schedId) continue;
            const resources = pol.resources || pol.resource || pol.doors || [];
            const entry = scheduleToDoors.get(schedId) || { doorIds: [], doorLabels: [] };
            for (const r of resources) {
              const dId = typeof r === 'string' ? r : (r.id || r.unique_id || r.door_id);
              const dLabel = typeof r === 'object' ? (r.name || r.label) : undefined;
              if (dId && !entry.doorIds.includes(String(dId))) {
                entry.doorIds.push(String(dId));
                if (dLabel) entry.doorLabels.push(String(dLabel));
              }
            }
            scheduleToDoors.set(schedId, entry);
          }
        }
      } catch {}
    }

    // 4. Fetch door-specific unlock schedules for each individual door
    try {
      const allDoors = await this.getDoors();
      logger.info(`[UniFi] Inspecting ${allDoors.length} door(s) for door-level unlock schedules…`);

      for (const dr of allDoors) {
        const doorId = String(dr.id || '');
        if (!doorId) continue;
        const doorName = String(dr.name || dr.full_name || 'Door');

        let doorDetail: any = dr;
        try {
          const detailRes = await this.getDoorDetails(doorId);
          if (detailRes && typeof detailRes === 'object') {
            doorDetail = { ...doorDetail, ...detailRes };
          }
        } catch {}

        // 4a. Check for linked schedule ID on the door
        const linkedSchedId = String(
          doorDetail.unlock_schedule_id ||
          doorDetail.schedule_id ||
          doorDetail.keep_open_schedule_id ||
          doorDetail.door_unlock_rule?.schedule_id ||
          doorDetail.door_unlock_rule?.unlock_schedule_id ||
          doorDetail.unlock_schedule?.id ||
          doorDetail.schedule?.id ||
          ''
        );

        if (linkedSchedId) {
          let sched = schedulesMap.get(linkedSchedId);
          if (!sched) {
            try {
              sched = await this.getSchedule(linkedSchedId);
              if (sched) {
                schedulesMap.set(sched.id, sched);
              }
            } catch (err) {
              logger.debug(`[UniFi] Could not fetch schedule ${linkedSchedId} for ${doorName}: ${err}`);
            }
          }

          if (sched) {
            const entry = scheduleToDoors.get(sched.id) || { doorIds: [], doorLabels: [] };
            if (!entry.doorIds.includes(doorId)) {
              entry.doorIds.push(doorId);
              entry.doorLabels.push(doorName);
            }
            scheduleToDoors.set(sched.id, entry);
          }
        }

        // 4b. Check for embedded unlock schedule object directly on the door
        const embedded =
          doorDetail.door_unlock_rule ||
          doorDetail.unlock_schedule ||
          doorDetail.schedule ||
          doorDetail.keep_open_schedule ||
          doorDetail.work_time_rule ||
          doorDetail.schedule_rule;

        if (embedded && typeof embedded === 'object') {
          const schedId = String(embedded.id || embedded.unique_id || `door-sched-${doorId}`);
          const schedName = String(embedded.name || `${doorName} Unlock Schedule`);
          const normalized = normalizeUnifiSchedule({
            ...embedded,
            id: schedId,
            name: schedName,
            type: 'unlock',
            doors: [{ id: doorId, name: doorName }],
          });

          // Check if this rule has active hours or days
          const hasActiveSlots = normalized.weekly_schedule?.some((d) => d.active && d.slots.length > 0);
          if (hasActiveSlots || !schedulesMap.has(schedId)) {
            schedulesMap.set(schedId, normalized);
            const entry = scheduleToDoors.get(schedId) || { doorIds: [], doorLabels: [] };
            if (!entry.doorIds.includes(doorId)) {
              entry.doorIds.push(doorId);
              entry.doorLabels.push(doorName);
            }
            scheduleToDoors.set(schedId, entry);
          }
        }

        // 4c. Check for pass_schedules or weekly_schedule directly on the door root
        const passList = doorDetail.pass_schedules || doorDetail.weekly_schedule || doorDetail.week_schedule;
        if (Array.isArray(passList) && passList.length > 0) {
          const schedId = `door-sched-${doorId}`;
          const schedName = `${doorName} Unlock Schedule`;
          const normalized = normalizeUnifiSchedule({
            id: schedId,
            name: schedName,
            type: 'unlock',
            weekly_schedule: passList,
            doors: [{ id: doorId, name: doorName }],
          });
          schedulesMap.set(schedId, normalized);
          scheduleToDoors.set(schedId, { doorIds: [doorId], doorLabels: [doorName] });
        }
      }
    } catch (err) {
      logger.warn(`[UniFi] Could not inspect doors for schedules: ${err}`);
    }

    // 5. Connect doors to schedules
    for (const [schedId, doors] of scheduleToDoors.entries()) {
      let sched = schedulesMap.get(schedId);
      if (sched) {
        if (!sched.door_ids) sched.door_ids = [];
        if (!sched.door_labels) sched.door_labels = [];
        for (const dId of doors.doorIds) {
          if (!sched.door_ids.includes(dId)) sched.door_ids.push(dId);
        }
        for (const dLabel of doors.doorLabels) {
          if (!sched.door_labels.includes(dLabel)) sched.door_labels.push(dLabel);
        }
      }
    }

    const allSchedules = Array.from(schedulesMap.values());
    logger.info(`[UniFi] Resolved ${allSchedules.length} schedule(s) across doors`);
    return allSchedules;
  }

  /**
   * Fetch detailed door configuration from developer and proxy endpoints.
   */
  async getDoorDetails(doorId: string): Promise<any> {
    const endpoints = [
      ...this.getDeveloperEndpoints('doors', encodeURIComponent(doorId)),
      `/proxy/access/api/v2/door/${encodeURIComponent(doorId)}`,
      `/proxy/access/api/v2/doors/${encodeURIComponent(doorId)}`,
      `/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(doorId)}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const data = res.data?.data || res.data;
        if (data && typeof data === 'object') {
          return data;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Get a single schedule by ID.
   */
  async getSchedule(scheduleId: string): Promise<UnifiSchedule> {
    const endpoints = [
      ...this.getScheduleEndpoints(encodeURIComponent(scheduleId)),
      `/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const data = res.data?.data || res.data;
        if (data) return normalizeUnifiSchedule(data);
      } catch {}
    }

    throw new Error(`Schedule ${scheduleId} not found in UniFi Access.`);
  }

  /**
   * Create a new schedule in UniFi Access.
   */
  async createSchedule(schedule: Partial<UnifiSchedule>): Promise<UnifiSchedule> {
    const payload = serializeUnifiSchedule(schedule);
    const endpoints = this.getScheduleEndpoints();

    let created: UnifiSchedule | null = null;
    for (const ep of endpoints) {
      try {
        const res = await this.http.post<UnifiApiResponse<any>>(ep, payload);
        if (res.data?.data) {
          logger.info(`UniFi schedule created via Developer API (${ep}): ${res.data.data.id || schedule.name}`);
          created = normalizeUnifiSchedule(res.data.data);
          break;
        }
      } catch {}
    }

    if (!created) {
      const res = await this.http.post<{ code: number; data: any }>(
        '/proxy/access/api/v2/schedules',
        payload
      );
      logger.info(`UniFi schedule created via v2 API: ${res.data?.data?.id || schedule.name}`);
      created = normalizeUnifiSchedule(res.data?.data ?? payload);
    }

    // If door_ids assigned, bind unlock schedule to doors
    if (created.id && schedule.door_ids && Array.isArray(schedule.door_ids)) {
      for (const dId of schedule.door_ids) {
        try {
          await this.http.put(`/proxy/access/api/v2/doors/${encodeURIComponent(dId)}`, {
            unlock_schedule_id: created.id,
          });
        } catch {
          try {
            await this.http.put(`/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(dId)}/unlock_rule`, {
              schedule_id: created.id,
            });
          } catch {}
        }
      }
    }

    return created;
  }

  /**
   * Update an existing schedule in UniFi Access.
   */
  async updateSchedule(scheduleId: string, updates: Partial<UnifiSchedule>): Promise<UnifiSchedule> {
    const payload = serializeUnifiSchedule(updates);
    const endpoints = this.getScheduleEndpoints(encodeURIComponent(scheduleId));

    let updated: UnifiSchedule | null = null;
    for (const ep of endpoints) {
      try {
        const res = await this.http.put<UnifiApiResponse<any>>(ep, payload);
        if (res.data?.data) {
          logger.info(`UniFi schedule ${scheduleId} updated via Developer API (${ep}).`);
          updated = normalizeUnifiSchedule(res.data.data);
          break;
        }
      } catch {}
    }

    if (!updated) {
      const res = await this.http.put<{ code: number; data: any }>(
        `/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`,
        payload
      );
      logger.info(`UniFi schedule ${scheduleId} updated via v2 API.`);
      updated = normalizeUnifiSchedule(res.data?.data ?? { id: scheduleId, ...payload });
    }

    // Apply door assignments to physical doors in UniFi
    if (updates.door_ids && Array.isArray(updates.door_ids)) {
      for (const dId of updates.door_ids) {
        try {
          await this.http.put(`/proxy/access/api/v2/doors/${encodeURIComponent(dId)}`, {
            unlock_schedule_id: scheduleId,
          });
        } catch {
          try {
            await this.http.put(`/proxy/access/api/v2/dashboard/locations/${encodeURIComponent(dId)}/unlock_rule`, {
              schedule_id: scheduleId,
            });
          } catch {}
        }
      }
    }

    return updated;
  }

  /**
   * Delete a schedule from UniFi Access.
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    const endpoints = this.getScheduleEndpoints(encodeURIComponent(scheduleId));

    for (const ep of endpoints) {
      try {
        await this.http.delete(ep);
        logger.info(`UniFi schedule ${scheduleId} deleted via Developer API (${ep}).`);
        return;
      } catch {
        // Fall through
      }
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
   * Generates prioritized candidate endpoints for the UniFi Access Developer API.
   * On local LAN setups, the Access Developer API runs on dedicated port 12445.
   * On port 443 console sessions, it is proxied under /proxy/access/integration/...
   * or /proxy/access/api/v1/developer/...
   */
  private getDeveloperEndpoints(resource: string, subpath = ''): string[] {
    const endpoints: string[] = [];
    const cleanSub = subpath ? (subpath.startsWith('/') ? subpath : `/${subpath}`) : '';
    try {
      const u = new URL(this.host);
      // 1. Dedicated Developer API port (12445) on controller LAN (both https and http)
      endpoints.push(`https://${u.hostname}:12445/api/v1/developer/${resource}${cleanSub}`);
      endpoints.push(`http://${u.hostname}:12445/api/v1/developer/${resource}${cleanSub}`);
    } catch {}

    // 2. Port 443 proxy endpoints
    endpoints.push(`/proxy/access/integration/v1/developer/${resource}${cleanSub}`);
    endpoints.push(`/proxy/access/api/v1/developer/${resource}${cleanSub}`);
    endpoints.push(`/api/v1/developer/${resource}${cleanSub}`);
    return endpoints;
  }

  private getVisitorEndpoints(subpath = ''): string[] {
    return this.getDeveloperEndpoints('visitors', subpath);
  }

  private getScheduleEndpoints(subpath = ''): string[] {
    return [
      ...this.getDeveloperEndpoints('schedules', subpath),
      ...this.getDeveloperEndpoints('access_policies/schedules', subpath),
      ...this.getDeveloperEndpoints('door_unlock_rules', subpath),
    ];
  }

  private getAccessPolicyEndpoints(subpath = ''): string[] {
    return this.getDeveloperEndpoints('access_policies', subpath);
  }

  /**
   * Fetch all visitors from UniFi Access.
   */
  async getVisitors(): Promise<UnifiVisitor[]> {
    const endpoints = this.getVisitorEndpoints();
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const rawList = Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.data?.list)
          ? res.data.data.list
          : Array.isArray(res.data?.data?.visitors)
          ? res.data.data.visitors
          : Array.isArray(res.data?.list)
          ? res.data.list
          : Array.isArray(res.data)
          ? res.data
          : null;

        if (rawList !== null) {
          logger.info(`[UniFi] Fetched ${rawList.length} visitor(s) via ${endpoint}`);
          return rawList.map((item: any) => normalizeUnifiVisitor(item));
        }
      } catch (err: any) {
        lastErr = err;
        logger.debug(`[UniFi] getVisitors tried ${endpoint}: ${err.response?.status || err.message}`);
      }
    }

    // Fallback: v2 visitors endpoint
    try {
      const res = await this.http.get<any>('/proxy/access/api/v2/visitors');
      const rawList = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : null;
      if (rawList) {
        logger.info(`[UniFi] Fetched ${rawList.length} visitor(s) via /proxy/access/api/v2/visitors`);
        return rawList.map((item: any) => normalizeUnifiVisitor(item));
      }
    } catch (err: any) {
      lastErr = err;
    }

    if (lastErr) {
      logger.warn(`[UniFi] getVisitors failed across all endpoints: ${lastErr.message}`);
    }
    return [];
  }

  /**
   * Get a single visitor by ID.
   */
  async getVisitor(visitorId: string): Promise<UnifiVisitor> {
    const endpoints = this.getVisitorEndpoints(`/${encodeURIComponent(visitorId)}`);
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.get<any>(endpoint);
        const rawData = res.data?.data || res.data;
        if (rawData && (rawData.id || rawData.unique_id || rawData.first_name || rawData.name)) {
          return normalizeUnifiVisitor(rawData);
        }
      } catch (err: any) {
        lastErr = err;
        logger.debug(`[UniFi] getVisitor tried ${endpoint}: ${err.response?.status || err.message}`);
      }
    }

    throw new Error(
      `Visitor ${visitorId} not found in UniFi Access. Last error: ${
        lastErr?.response?.data?.msg || lastErr?.response?.data?.message || lastErr?.message || lastErr
      }`
    );
  }

  /**
   * Create a new visitor in UniFi Access.
   */
  async createVisitor(visitor: Partial<UnifiVisitor>): Promise<UnifiVisitor> {
    const payload = serializeUnifiVisitor(visitor);
    const endpoints = this.getVisitorEndpoints();
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.post<any>(endpoint, payload);
        const rawData = res.data?.data || res.data;
        if (rawData) {
          logger.info(`[UniFi] Visitor ${rawData.id || visitor.first_name} created successfully via ${endpoint}`);
          const normalized = normalizeUnifiVisitor(rawData);
          // If PIN code is specified, assign via PUT /visitors/:id/pin_codes (official Developer API)
          if (visitor.pin_code && normalized.id) {
            await this.assignVisitorPin(normalized.id, visitor.pin_code).catch((err) => {
              logger.warn(`[UniFi] Could not assign PIN to visitor ${normalized.id}: ${err.message}`);
            });
            normalized.pin_code = visitor.pin_code;
          }
          return normalized;
        }
      } catch (err: any) {
        lastErr = err;
        const status = err.response?.status;
        const msg = err.response?.data?.msg || err.response?.data?.message || err.message;
        logger.warn(`[UniFi] createVisitor tried ${endpoint} -> status ${status || 'ERR'}: ${msg}`);
      }
    }

    throw new Error(
      `Failed to create visitor in UniFi Access across all endpoints. Last error: ${
        lastErr?.response?.data?.msg || lastErr?.response?.data?.message || lastErr?.message || lastErr
      }`
    );
  }

  /**
   * Update an existing visitor in UniFi Access.
   */
  async updateVisitor(visitorId: string, updates: Partial<UnifiVisitor>): Promise<UnifiVisitor> {
    const payload = serializeUnifiVisitor(updates);
    const endpoints = this.getVisitorEndpoints(`/${encodeURIComponent(visitorId)}`);
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        const res = await this.http.put<any>(endpoint, payload);
        const rawData = res.data?.data || res.data;
        if (rawData) {
          logger.info(`[UniFi] Visitor ${visitorId} updated successfully via ${endpoint}`);
          const normalized = normalizeUnifiVisitor(rawData);
          if (updates.pin_code) {
            await this.assignVisitorPin(visitorId, updates.pin_code).catch(() => {});
            normalized.pin_code = updates.pin_code;
          }
          return normalized;
        }
      } catch (err: any) {
        lastErr = err;
        logger.debug(`[UniFi] updateVisitor tried ${endpoint} -> ${err.response?.status || err.message}`);
      }
    }

    throw new Error(
      `Failed to update visitor ${visitorId} in UniFi Access. Last error: ${
        lastErr?.response?.data?.msg || lastErr?.response?.data?.message || lastErr?.message || lastErr
      }`
    );
  }

  /**
   * Delete or revoke a visitor from UniFi Access.
   */
  async deleteVisitor(visitorId: string): Promise<void> {
    const endpoints = this.getVisitorEndpoints(`/${encodeURIComponent(visitorId)}`);
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        await this.http.delete(endpoint);
        logger.info(`[UniFi] Visitor ${visitorId} deleted successfully via ${endpoint}`);
        return;
      } catch (err: any) {
        lastErr = err;
        logger.debug(`[UniFi] deleteVisitor tried ${endpoint} -> ${err.response?.status || err.message}`);
      }
    }

    throw new Error(
      `Failed to delete visitor ${visitorId} in UniFi Access. Last error: ${
        lastErr?.response?.data?.msg || lastErr?.response?.data?.message || lastErr?.message || lastErr
      }`
    );
  }

  /**
   * Assign a PIN code to a visitor (UniFi Access Developer API Sec 4.9).
   */
  async assignVisitorPin(visitorId: string, pinCode: string): Promise<void> {
    const endpoints = this.getDeveloperEndpoints('visitors', `${encodeURIComponent(visitorId)}/pin_codes`);
    let lastErr: any = null;

    for (const endpoint of endpoints) {
      try {
        await this.http.put(endpoint, { pin_code: String(pinCode) });
        logger.info(`[UniFi] PIN code assigned to visitor ${visitorId} via ${endpoint}`);
        return;
      } catch (err: any) {
        lastErr = err;
      }
    }
    logger.warn(`[UniFi] assignVisitorPin failed across endpoints: ${lastErr?.message}`);
  }

  /**
   * Unassign a PIN code from a visitor (UniFi Access Developer API Sec 4.10).
   */
  async unassignVisitorPin(visitorId: string): Promise<void> {
    const endpoints = this.getDeveloperEndpoints('visitors', `${encodeURIComponent(visitorId)}/pin_codes`);

    for (const endpoint of endpoints) {
      try {
        await this.http.delete(endpoint);
        logger.info(`[UniFi] PIN code unassigned from visitor ${visitorId}`);
        return;
      } catch {}
    }
  }

  /**
   * Fetch system access logs from UniFi Access.
   * Tracks who opened or closed doors, timestamps, and access methods
   * (NFC Card/Fob, Keypad PIN, Mobile Tap, Hand Wave, Remote, Face).
   */
  async getAccessLogs(options?: {
    since?: number;
    until?: number;
    pageSize?: number;
    topic?: string;
    maxPages?: number;
  }): Promise<AccessLogEntry[]> {
    const endpoints = [
      ...this.getDeveloperEndpoints('system/logs'),
      '/proxy/access/api/v2/activities',
      '/proxy/access/api/v2/events',
    ];

    const pageSize = options?.pageSize || 100;
    const maxPages = options?.maxPages || 10;
    const allEntries: AccessLogEntry[] = [];
    const seenIds = new Set<string>();

    for (const endpoint of endpoints) {
      try {
        let page = 1;
        let consecutiveEmpty = 0;

        while (page <= maxPages) {
          let res: any;
          if (endpoint.includes('/v2/')) {
            res = await this.http.get(endpoint, {
              params: {
                page,
                page_size: pageSize,
                ...(options?.since ? { since: options.since } : {}),
                ...(options?.until ? { until: options.until } : {}),
              },
            });
          } else {
            res = await this.http.post(
              endpoint,
              {
                topic: options?.topic || 'door_openings',
                ...(options?.since ? { since: options.since } : {}),
                ...(options?.until ? { until: options.until } : {}),
              },
              {
                params: {
                  page_num: page,
                  page_size: pageSize,
                },
              }
            );
          }

          // Developer API returns data.hits, v2 returns data or data.list/activities
          const rawList = Array.isArray(res.data?.data?.hits)
            ? res.data.data.hits
            : Array.isArray(res.data?.data)
            ? res.data.data
            : Array.isArray(res.data?.data?.list)
            ? res.data.data.list
            : Array.isArray(res.data?.data?.activities)
            ? res.data.data.activities
            : Array.isArray(res.data?.list)
            ? res.data.list
            : Array.isArray(res.data)
            ? res.data
            : null;

          if (!rawList || rawList.length === 0) {
            consecutiveEmpty++;
            if (consecutiveEmpty >= 1) break;
          } else {
            consecutiveEmpty = 0;
            let addedThisPage = 0;
            for (const item of rawList) {
              const normalized = normalizeAccessLogEntry(item);
              if (!seenIds.has(normalized.id)) {
                seenIds.add(normalized.id);
                allEntries.push(normalized);
                addedThisPage++;
              }
            }

            if (rawList.length < pageSize || addedThisPage === 0) {
              // Reached oldest available record
              break;
            }
          }
          page++;
        }

        if (allEntries.length > 0) {
          logger.info(`[UniFi] Fetched ${allEntries.length} access log(s) across ${page - 1} page(s) via ${endpoint}`);
          return allEntries;
        }
      } catch (err: any) {
        logger.debug(`[UniFi] getAccessLogs tried ${endpoint} -> ${err.response?.status || err.message}`);
      }
    }

    return [];
  }
}
