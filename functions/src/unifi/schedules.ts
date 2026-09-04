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
      const batch = db.batch();
      const now = FieldValue.serverTimestamp();

      for (const schedule of normalizedSchedules) {
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
