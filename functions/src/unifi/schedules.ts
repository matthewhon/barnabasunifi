import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import * as https from 'https';
import { UnifiSchedule, DayOfWeek, UnifiWeeklyScheduleDay } from '../types';

// ---------------------------------------------------------------------------
// Helpers & Types
// ---------------------------------------------------------------------------

const DAYS_OF_WEEK: DayOfWeek[] = [
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

  if (typeof rawTime === 'number') {
    const totalMinutes = Math.floor(rawTime / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  const str = String(rawTime).trim();
  if (!str) return defaultVal;

  if (/^\d{4,6}$/.test(str)) {
    const num = parseInt(str, 10);
    const totalMinutes = Math.floor(num / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

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

async function verifyOrgPermission(
  auth: { uid: string; token: Record<string, unknown> } | undefined,
  orgId: string,
  allowedRoles: string[] = ['org_admin', 'manager']
) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const role = auth.token.role as string | undefined;
  const tokenOrgId = auth.token.orgId as string | undefined;

  if (role === 'super_admin') return;

  if (tokenOrgId === orgId && role && allowedRoles.includes(role)) {
    return;
  }

  const db = getFirestore();
  const userDoc = await db.doc(`users/${auth.uid}`).get();
  if (userDoc.exists) {
    const userData = userDoc.data();
    if (userData?.role === 'super_admin') return;
    const memberships = userData?.org_memberships;
    let membershipRole: string | undefined;
    if (Array.isArray(memberships)) {
      membershipRole = memberships.find((m: any) => m.org_id === orgId)?.role;
    } else if (memberships && typeof memberships === 'object') {
      membershipRole = memberships[orgId]?.role;
    }
    if (membershipRole && allowedRoles.includes(membershipRole)) {
      return;
    }
  }

  throw new HttpsError('permission-denied', 'You do not have permission for this organization.');
}

// ---------------------------------------------------------------------------
// Callable Functions
// ---------------------------------------------------------------------------

/**
 * syncUnifiSchedules
 * Pulls existing schedules from UniFi Access.
 * Direct remote execution if remote mode, or queues agent command if agent mode.
 */
export const syncUnifiSchedules = onCall<{ orgId: string }>(
  async (request) => {
    const { orgId } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');

    await verifyOrgPermission(request.auth, orgId, ['org_admin', 'manager', 'viewer']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        throw new HttpsError('failed-precondition', 'Remote UniFi configuration missing host or access token.');
      }

      const host = remoteConfig.host.replace(/\/$/, '');
      const agent = new https.Agent({ rejectUnauthorized: false });
      const client = axios.create({
        baseURL: host,
        httpsAgent: agent,
        headers: {
          'X-API-KEY': remoteConfig.access_token,
          Authorization: `Bearer ${remoteConfig.access_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      let rawSchedules: any[] = [];

      try {
        const res = await client.get('/proxy/access/integration/v1/developer/schedules');
        rawSchedules = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch {
        try {
          const res = await client.get('/api/v1/developer/schedules');
          rawSchedules = Array.isArray(res.data?.data) ? res.data.data : [];
        } catch {
          const res = await client.get('/proxy/access/api/v2/schedules');
          rawSchedules = Array.isArray(res.data?.data) ? res.data.data : [];
        }
      }

      const normalizedSchedules = rawSchedules.map((item) => normalizeUnifiSchedule(item, orgId));
      const schedulesMap = new Map<string, UnifiSchedule>();
      for (const s of normalizedSchedules) {
        if (s.id) schedulesMap.set(s.id, s);
      }

      // Fetch doors to discover door-level unlock rules
      let rawDoors: any[] = [];
      try {
        const res = await client.get('/api/v1/developer/doors');
        rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
      } catch {
        try {
          const res = await client.get('/proxy/access/integration/v1/developer/doors');
          rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
        } catch {
          try {
            const res = await client.get('/proxy/access/api/v2/doors');
            rawDoors = Array.isArray(res.data?.data) ? res.data.data : [];
          } catch {}
        }
      }

      for (const dr of rawDoors) {
        const doorId = String(dr.id || dr.unique_id || '');
        if (!doorId) continue;
        const doorName = String(dr.name || dr.full_name || 'Door');

        // Check linked schedule
        const linkedId = String(dr.unlock_schedule_id || dr.schedule_id || dr.keep_open_schedule_id || dr.door_unlock_rule?.schedule_id || '');
        if (linkedId && schedulesMap.has(linkedId)) {
          const sched = schedulesMap.get(linkedId)!;
          if (!sched.door_ids) sched.door_ids = [];
          if (!sched.door_labels) sched.door_labels = [];
          if (!sched.door_ids.includes(doorId)) sched.door_ids.push(doorId);
          if (!sched.door_labels.includes(doorName)) sched.door_labels.push(doorName);
        }

        // Check embedded rule
        const embedded = dr.door_unlock_rule || dr.unlock_schedule || dr.schedule || dr.keep_open_schedule;
        if (embedded && typeof embedded === 'object') {
          const schedId = String(embedded.id || embedded.unique_id || `door-sched-${doorId}`);
          const schedName = String(embedded.name || `${doorName} Unlock Schedule`);
          const normalized = normalizeUnifiSchedule({
            ...embedded,
            id: schedId,
            name: schedName,
            type: 'unlock',
            doors: [{ id: doorId, name: doorName }],
          }, orgId);
          schedulesMap.set(schedId, normalized);
        }
      }

      const allSchedules = Array.from(schedulesMap.values());
      const batch = db.batch();
      const now = FieldValue.serverTimestamp();

      for (const schedule of allSchedules) {
        if (!schedule.id) continue;
        const ref = db.doc(`organizations/${orgId}/unifi_schedules/${schedule.id}`);
        batch.set(ref, {
          ...schedule,
          org_id: orgId,
          last_synced: now,
          sync_status: 'synced',
          sync_error: null,
          updated_at: now,
        }, { merge: true });

        if (schedule.door_ids && Array.isArray(schedule.door_ids)) {
          for (const dId of schedule.door_ids) {
            const doorRef = db.doc(`organizations/${orgId}/doors/${dId}`);
            batch.set(doorRef, {
              schedule_id: schedule.id,
              schedule_name: schedule.name,
            }, { merge: true });
          }
        }
      }

      await batch.commit();

      return {
        success: true,
        mode: 'remote',
        count: normalizedSchedules.length,
      };
    }

    // Agent mode: Queue command for local agent
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'sync_schedules',
      status: 'queued',
      execute_at: new Date().toISOString(),
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: new Date().toISOString(),
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);

/**
 * saveUnifiSchedule
 * Creates or updates a UniFi Access schedule.
 */
export const saveUnifiSchedule = onCall<{ orgId: string; schedule: Partial<UnifiSchedule> }>(
  async (request) => {
    const { orgId, schedule } = request.data ?? {};
    if (!orgId) throw new HttpsError('invalid-argument', 'orgId is required.');
    if (!schedule || !schedule.name) {
      throw new HttpsError('invalid-argument', 'Valid schedule data with name is required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (!remoteConfig?.host || !remoteConfig?.access_token) {
        throw new HttpsError('failed-precondition', 'Remote UniFi configuration missing host or access token.');
      }

      const host = remoteConfig.host.replace(/\/$/, '');
      const agent = new https.Agent({ rejectUnauthorized: false });
      const client = axios.create({
        baseURL: host,
        httpsAgent: agent,
        headers: {
          'X-API-KEY': remoteConfig.access_token,
          Authorization: `Bearer ${remoteConfig.access_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const payload = serializeUnifiSchedule(schedule);
      let savedRaw: any;

      if (schedule.id) {
        // Update
        try {
          const res = await client.put(`/proxy/access/integration/v1/developer/schedules/${encodeURIComponent(schedule.id)}`, payload);
          savedRaw = res.data?.data ?? { id: schedule.id, ...payload };
        } catch {
          const res = await client.put(`/proxy/access/api/v2/schedule/${encodeURIComponent(schedule.id)}`, payload);
          savedRaw = res.data?.data ?? { id: schedule.id, ...payload };
        }
      } else {
        // Create
        try {
          const res = await client.post('/proxy/access/integration/v1/developer/schedules', payload);
          savedRaw = res.data?.data ?? payload;
        } catch {
          const res = await client.post('/proxy/access/api/v2/schedules', payload);
          savedRaw = res.data?.data ?? payload;
        }
      }

      const normalized = normalizeUnifiSchedule(savedRaw, orgId);
      const scheduleId = normalized.id || schedule.id;

      if (!scheduleId) {
        throw new HttpsError('internal', 'UniFi schedule saved but no ID was returned.');
      }

      const now = FieldValue.serverTimestamp();
      await db.doc(`organizations/${orgId}/unifi_schedules/${scheduleId}`).set({
        ...normalized,
        org_id: orgId,
        last_synced: now,
        sync_status: 'synced',
        sync_error: null,
        updated_at: now,
      }, { merge: true });

      return {
        success: true,
        mode: 'remote',
        schedule: normalized,
      };
    }

    // Agent mode: Store optimistic/pending state in Firestore and queue command
    const targetScheduleId = schedule.id || db.collection(`organizations/${orgId}/unifi_schedules`).doc().id;
    const nowIso = new Date().toISOString();

    const pendingSchedule: Partial<UnifiSchedule> = {
      ...schedule,
      id: targetScheduleId,
      unifi_schedule_id: targetScheduleId,
      org_id: orgId,
      sync_status: 'pending',
      updated_at: nowIso,
    };

    await db.doc(`organizations/${orgId}/unifi_schedules/${targetScheduleId}`).set(pendingSchedule, { merge: true });

    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: schedule.id ? 'update_schedule' : 'create_schedule',
      schedule_id: targetScheduleId,
      schedule_data: schedule,
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
      scheduleId: targetScheduleId,
    };
  }
);

/**
 * deleteUnifiSchedule
 * Deletes a schedule from UniFi Access and removes it from Firestore.
 */
export const deleteUnifiSchedule = onCall<{ orgId: string; scheduleId: string }>(
  async (request) => {
    const { orgId, scheduleId } = request.data ?? {};
    if (!orgId || !scheduleId) {
      throw new HttpsError('invalid-argument', 'orgId and scheduleId are required.');
    }

    await verifyOrgPermission(request.auth, orgId, ['org_admin']);

    const db = getFirestore();
    const configSnap = await db.collection('organizations').doc(orgId).collection('settings').doc('config').get();
    const configData = configSnap.exists ? configSnap.data() : null;
    const unifiMode = configData?.unifi_mode ?? 'agent';

    if (unifiMode === 'remote') {
      const remoteConfig = configData?.unifi_remote;
      if (remoteConfig?.host && remoteConfig?.access_token) {
        const host = remoteConfig.host.replace(/\/$/, '');
        const agent = new https.Agent({ rejectUnauthorized: false });
        const client = axios.create({
          baseURL: host,
          httpsAgent: agent,
          headers: {
            'X-API-KEY': remoteConfig.access_token,
            Authorization: `Bearer ${remoteConfig.access_token}`,
          },
          timeout: 15000,
        });

        try {
          await client.delete(`/proxy/access/integration/v1/developer/schedules/${encodeURIComponent(scheduleId)}`);
        } catch {
          try {
            await client.delete(`/proxy/access/api/v2/schedule/${encodeURIComponent(scheduleId)}`);
          } catch (err) {
            console.warn(`Could not delete schedule ${scheduleId} on remote host:`, err);
          }
        }
      }

      await db.doc(`organizations/${orgId}/unifi_schedules/${scheduleId}`).delete();

      return {
        success: true,
        mode: 'remote',
      };
    }

    // Agent mode: Queue command
    const nowIso = new Date().toISOString();
    const commandRef = await db.collection(`organizations/${orgId}/door_commands`).add({
      action: 'delete_schedule',
      schedule_id: scheduleId,
      status: 'queued',
      execute_at: nowIso,
      triggered_by: 'manual',
      actor_uid: request.auth?.uid ?? null,
      created_at: nowIso,
      org_id: orgId,
    });

    return {
      success: true,
      mode: 'agent',
      commandId: commandRef.id,
    };
  }
);
