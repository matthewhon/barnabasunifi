import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { PcoClient, PcoResource } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgSettings {
  unlock_buffer_before_min: number;
  lock_buffer_after_min: number;
  timezone: string;
}

interface MappingData {
  id: string;
  source_type?: 'service' | 'group';
  pco_resource_id?: string;
  pco_resource_label?: string;
  service_type_id?: string;
  group_id?: string;
  door_ids?: string[];
  door_labels?: string[];
  enabled?: boolean;
  time_types?: string[];
  enabled_time_types?: string[];
}

interface SyncResult {
  windowsCreated: number;
  windowsUpdated: number;
}

interface TriggerPcoSyncRequest {
  // No additional input needed; orgId comes from auth claims
}

interface TriggerPcoSyncResponse {
  success: true;
  windowsCreated: number;
  windowsUpdated: number;
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

/**
 * Syncs PCO schedule data for a given organization:
 * - Fetches enabled service and group mappings from Firestore
 * - Pulls upcoming plans/events from the PCO API
 * - Upserts schedule_windows in Firestore
 * - Creates door_commands for windows within the next 24 hours
 * - Writes an audit log entry
 */
export async function syncOrgSchedule(orgId: string): Promise<SyncResult> {
  const db = getFirestore();
  const orgRef = db.collection('organizations').doc(orgId);

  // 1. Load org settings
  const configSnap = await orgRef.collection('settings').doc('config').get();
  if (!configSnap.exists) {
    throw new Error(`No settings config found for org ${orgId}`);
  }

  const settings = configSnap.data() as OrgSettings;
  const unlockBufferMs = (settings.unlock_buffer_before_min ?? 15) * 60 * 1000;
  const lockBufferMs = (settings.lock_buffer_after_min ?? 15) * 60 * 1000;

  // 2. Load enabled mappings from /organizations/{orgId}/mappings and subcollections
  const [mappingsSnap, serviceMappingsSnap, groupMappingsSnap] = await Promise.all([
    orgRef.collection('mappings').where('enabled', '==', true).get(),
    orgRef.collection('service_mappings').where('enabled', '==', true).get(),
    orgRef.collection('group_mappings').where('enabled', '==', true).get(),
  ]);

  const generalMappings: MappingData[] = mappingsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<MappingData, 'id'>),
  }));

  const serviceMappings: MappingData[] = [
    ...generalMappings.filter((m) => m.source_type === 'service' || m.service_type_id),
    ...serviceMappingsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MappingData, 'id'>) })),
  ];

  const groupMappings: MappingData[] = [
    ...generalMappings.filter((m) => m.source_type === 'group' || m.group_id),
    ...groupMappingsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MappingData, 'id'>) })),
  ];

  // 3. Initialize PCO client
  const client = new PcoClient(orgId);
  await client.init();

  const windowsRef = orgRef.collection('schedule_windows');
  const commandsRef = orgRef.collection('door_commands');
  const now = Date.now();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  let windowsCreated = 0;
  let windowsUpdated = 0;

  // Helper: upsert a schedule window and optionally create door commands
  async function upsertWindow(
    idempotencyKey: string,
    startsAt: Date,
    endsAt: Date,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const unlockAt = new Date(startsAt.getTime() - unlockBufferMs);
    const lockAt = new Date(endsAt.getTime() + lockBufferMs);

    // Query for an existing window with this idempotency key
    const existingSnap = await windowsRef
      .where('idempotency_key', '==', idempotencyKey)
      .limit(1)
      .get();

    const windowData = {
      idempotency_key: idempotencyKey,
      starts_at: Timestamp.fromDate(startsAt),
      ends_at: Timestamp.fromDate(endsAt),
      unlock_at: Timestamp.fromDate(unlockAt),
      lock_at: Timestamp.fromDate(lockAt),
      updated_at: FieldValue.serverTimestamp(),
      ...metadata,
    };

    let windowId: string;

    if (existingSnap.empty) {
      const newWindowRef = await windowsRef.add({
        ...windowData,
        created_at: FieldValue.serverTimestamp(),
      });
      windowId = newWindowRef.id;
      windowsCreated++;
    } else {
      const existingDoc = existingSnap.docs[0];
      windowId = existingDoc.id;
      await existingDoc.ref.update(windowData);
      windowsUpdated++;
    }

    // Create door_commands for windows within the next 24 hours ONLY if doors are mapped
    const doorIds = (metadata.door_ids as string[]) ?? [];
    if (doorIds.length > 0 && unlockAt.getTime() - now < twentyFourHoursMs) {
      await createDoorCommandIfAbsent(commandsRef, windowId, 'unlock', unlockAt);
      await createDoorCommandIfAbsent(commandsRef, windowId, 'lock', lockAt);
    }
  }

  // Helper: create a door command only if one doesn't already exist for this window+action
  async function createDoorCommandIfAbsent(
    ref: FirebaseFirestore.CollectionReference,
    windowId: string,
    action: 'unlock' | 'lock',
    executeAt: Date
  ): Promise<void> {
    const existingSnap = await ref
      .where('window_id', '==', windowId)
      .where('action', '==', action)
      .limit(1)
      .get();

    if (!existingSnap.empty) return;

    await ref.add({
      window_id: windowId,
      action,
      execute_at: Timestamp.fromDate(executeAt),
      status: 'pending',
      created_at: FieldValue.serverTimestamp(),
    });
  }

  // 4. Process all Service Types from PCO
  try {
    const serviceTypes = await client.getServiceTypes();

    for (const st of serviceTypes) {
      const serviceTypeId = st.id;
      const serviceTypeName = (st.attributes?.name ?? 'Service') as string;

      // Find matching enabled mapping if available
      const mapping = serviceMappings.find(
        (m) => (m.pco_resource_id ?? m.service_type_id) === serviceTypeId
      );

      const doorIds = mapping?.door_ids ?? [];
      const doorLabels = mapping?.door_labels ?? [];
      const enabledTimeTypes = mapping?.time_types ?? mapping?.enabled_time_types;

      let plans: PcoResource[];
      try {
        plans = await client.getPlansForServiceType(serviceTypeId);
      } catch (err) {
        console.error(`Failed to fetch plans for service_type ${serviceTypeId}:`, err);
        continue;
      }

      for (const plan of plans) {
        const planId = plan.id;
        let planTimes: PcoResource[];

        try {
          planTimes = await client.getPlanTimes(serviceTypeId, planId);
        } catch (err) {
          console.error(`Failed to fetch plan_times for plan ${planId}:`, err);
          continue;
        }

        for (const planTime of planTimes) {
          const attrs = planTime.attributes as {
            starts_at?: string;
            ends_at?: string;
            time_type?: string;
          };

          // Filter by enabled time_types if specified on mapping
          if (
            enabledTimeTypes &&
            enabledTimeTypes.length > 0 &&
            attrs.time_type &&
            !enabledTimeTypes.includes(attrs.time_type)
          ) {
            continue;
          }

          if (!attrs.starts_at || !attrs.ends_at) continue;

          const startsAt = new Date(attrs.starts_at);
          const endsAt = new Date(attrs.ends_at);

          if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) continue;

          const idempotencyKey = `service:${serviceTypeId}:plan:${planId}:time:${planTime.id}`;
          const planDetail = (plan.attributes?.title ?? plan.attributes?.series_title ?? plan.attributes?.dates) as string | undefined;
          const planTitle = planDetail ? `${serviceTypeName}: ${planDetail}` : serviceTypeName;

          await upsertWindow(idempotencyKey, startsAt, endsAt, {
            source: 'pco_service',
            source_type: 'service',
            source_label: planTitle,
            pco_plan_id: planId,
            pco_plan_time_id: planTime.id,
            pco_service_type_id: serviceTypeId,
            service_mapping_id: mapping?.id ?? null,
            door_ids: doorIds,
            door_labels: doorLabels,
            status: 'pending',
          });
        }
      }
    }
  } catch (err) {
    console.error('Error fetching service types from PCO:', err);
  }

  // 5. Process all Groups from PCO
  try {
    const groups = await client.getGroups();

    for (const grp of groups) {
      const groupId = grp.id;
      const groupName = (grp.attributes?.name ?? 'Group') as string;

      // Find matching enabled mapping if available
      const mapping = groupMappings.find(
        (m) => (m.pco_resource_id ?? m.group_id) === groupId
      );

      const doorIds = mapping?.door_ids ?? [];
      const doorLabels = mapping?.door_labels ?? [];

      let events: PcoResource[];
      try {
        events = await client.getGroupEvents(groupId);
      } catch (err) {
        console.error(`Failed to fetch events for group ${groupId}:`, err);
        continue;
      }

      for (const event of events) {
        const attrs = event.attributes as {
          starts_at?: string;
          ends_at?: string;
          name?: string;
          title?: string;
        };

        if (!attrs.starts_at || !attrs.ends_at) continue;

        const startsAt = new Date(attrs.starts_at);
        const endsAt = new Date(attrs.ends_at);

        if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) continue;

        const idempotencyKey = `group:${groupId}:event:${event.id}`;
        const eventDetail = (attrs.name ?? attrs.title) as string | undefined;
        const eventTitle = eventDetail ? `${groupName}: ${eventDetail}` : groupName;

        await upsertWindow(idempotencyKey, startsAt, endsAt, {
          source: 'pco_group',
          source_type: 'group',
          source_label: eventTitle,
          pco_event_id: event.id,
          pco_group_id: groupId,
          group_mapping_id: mapping?.id ?? null,
          door_ids: doorIds,
          door_labels: doorLabels,
          status: 'pending',
        });
      }
    }
  } catch (err) {
    console.warn('Groups API unavailable or returned error:', err);
  }

  // 6. Write audit log
  await orgRef.collection('audit_logs').add({
    event: 'pco_sync',
    windows_created: windowsCreated,
    windows_updated: windowsUpdated,
    synced_at: FieldValue.serverTimestamp(),
  });

  return { windowsCreated, windowsUpdated };
}

// ---------------------------------------------------------------------------
// Callable Cloud Function: triggerPcoSync
// ---------------------------------------------------------------------------

/**
 * Callable Cloud Function: triggerPcoSync
 *
 * Allows an org_admin or manager to manually trigger a PCO schedule sync.
 */
export const triggerPcoSync = onCall<TriggerPcoSyncRequest, Promise<TriggerPcoSyncResponse>>(
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to trigger a PCO sync.');
    }

    const { role, orgId } = request.auth.token as { role?: string; orgId?: string };

    if (!role || !['org_admin', 'manager'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'You must be an org_admin or manager to trigger a PCO sync.'
      );
    }

    if (!orgId) {
      throw new HttpsError(
        'failed-precondition',
        'Your account is not associated with an organization.'
      );
    }

    try {
      const result = await syncOrgSchedule(orgId);
      return { success: true, ...result };
    } catch (err) {
      console.error(`PCO sync failed for org ${orgId}:`, err);
      throw new HttpsError('internal', 'PCO sync failed. Please check the function logs.');
    }
  }
);
