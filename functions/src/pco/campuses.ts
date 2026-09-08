import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { PcoClient, PcoResource } from './client';
import { PcoCampus, PcoLocation } from '../types';

interface GetCampusesAndLocationsRequest {
  orgId?: string;
  force?: boolean;
}

interface AssignDoorsRequest {
  orgId?: string;
  doorIds: string[];
  campusId?: string | null;
  campusName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
}

/**
 * Callable Cloud Function: getPcoCampusesAndLocations
 *
 * Fetches all Campuses and Locations/Rooms from Planning Center Online,
 * merges them with existing Firestore records, and returns them to the caller.
 */
export const getPcoCampusesAndLocations = onCall<
  GetCampusesAndLocationsRequest,
  Promise<{ campuses: PcoCampus[]; locations: PcoLocation[] }>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to fetch PCO campuses and locations.');
  }

  const tokenRole = (request.auth.token as any)?.role;
  const tokenOrgId = (request.auth.token as any)?.orgId;
  const orgId = request.data?.orgId || tokenOrgId;

  if (!orgId) {
    throw new HttpsError('invalid-argument', 'Organization ID is required.');
  }

  const isSuperAdmin = tokenRole === 'super_admin';
  if (!isSuperAdmin) {
    const db = getFirestore();
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    if (userData?.role !== 'super_admin') {
      const memberships = userData?.org_memberships;
      let role: string | undefined;
      if (Array.isArray(memberships)) {
        role = memberships.find((m: any) => m.org_id === orgId)?.role;
      } else if (memberships && typeof memberships === 'object') {
        role = memberships[orgId]?.role;
      }
      role = role || (tokenOrgId === orgId ? tokenRole : userData?.role);
      if (!role || !['org_admin', 'manager', 'viewer'].includes(role)) {
        throw new HttpsError(
          'permission-denied',
          'You do not have permission to view campuses and locations for this organization.'
        );
      }
    }
  }

  const db = getFirestore();
  const orgRef = db.collection('organizations').doc(orgId);

  try {
    const client = new PcoClient(orgId);
    await client.init();

    const [rawCampuses, rawLocations] = await Promise.all([
      client.getCampuses().catch((err) => {
        console.warn(`Could not load campuses from PCO for org ${orgId}:`, err);
        return [] as PcoResource[];
      }),
      client.getLocations().catch((err) => {
        console.warn(`Could not load locations from PCO for org ${orgId}:`, err);
        return [] as PcoResource[];
      }),
    ]);

    const batch = db.batch();
    const now = new Date().toISOString();

    // Map & Cache Campuses
    const campuses: PcoCampus[] = [];
    for (const item of rawCampuses) {
      const attrs = (item.attributes ?? {}) as Record<string, unknown>;
      const campus: PcoCampus = {
        id: item.id,
        org_id: orgId,
        name: (attrs.name ?? attrs.title ?? 'Main Campus') as string,
        description: (attrs.description ?? '') as string,
        street: (attrs.street ?? attrs.address_street ?? '') as string,
        city: (attrs.city ?? attrs.address_city ?? '') as string,
        state: (attrs.state ?? attrs.address_state ?? '') as string,
        zip: (attrs.zip ?? attrs.address_zip ?? '') as string,
        time_zone: (attrs.time_zone ?? attrs.timezone ?? '') as string,
        phone_number: (attrs.phone_number ?? attrs.contact_phone_number ?? '') as string,
        created_at: (attrs.created_at ?? now) as string,
        updated_at: now,
      };
      campuses.push(campus);

      const campusDocRef = orgRef.collection('campuses').doc(campus.id);
      batch.set(campusDocRef, campus, { merge: true });
    }

    // Map & Cache Locations / Rooms
    const locations: PcoLocation[] = [];
    for (const item of rawLocations) {
      const attrs = (item.attributes ?? {}) as Record<string, unknown>;
      const rels = (item.relationships ?? {}) as Record<string, any>;
      const campusRelId = rels.campus?.data?.id || (attrs.campus_id as string) || null;
      const matchingCampus = campuses.find((c) => c.id === campusRelId);

      const location: PcoLocation = {
        id: item.id,
        org_id: orgId,
        name: (attrs.name ?? attrs.title ?? attrs.label ?? 'Room') as string,
        campus_id: campusRelId,
        campus_name: matchingCampus?.name || (attrs.campus_name as string) || null,
        kind: (attrs.kind ?? attrs.type ?? item.type ?? 'room') as string,
        description: (attrs.description ?? '') as string,
        created_at: (attrs.created_at ?? now) as string,
        updated_at: now,
      };
      locations.push(location);

      const locDocRef = orgRef.collection('locations').doc(location.id);
      batch.set(locDocRef, location, { merge: true });
    }

    // Commit updates if any items were retrieved
    if (campuses.length > 0 || locations.length > 0) {
      await batch.commit();
    }

    // Also pull any custom campuses or locations stored in Firestore that might not be in PCO
    const [storedCampusesSnap, storedLocationsSnap] = await Promise.all([
      orgRef.collection('campuses').get(),
      orgRef.collection('locations').get(),
    ]);

    const allCampusesMap = new Map<string, PcoCampus>();
    storedCampusesSnap.docs.forEach((d) => {
      allCampusesMap.set(d.id, { id: d.id, ...(d.data() as Omit<PcoCampus, 'id'>) });
    });
    campuses.forEach((c) => allCampusesMap.set(c.id, c));

    const allLocationsMap = new Map<string, PcoLocation>();
    storedLocationsSnap.docs.forEach((d) => {
      allLocationsMap.set(d.id, { id: d.id, ...(d.data() as Omit<PcoLocation, 'id'>) });
    });
    locations.forEach((l) => allLocationsMap.set(l.id, l));

    return {
      campuses: Array.from(allCampusesMap.values()),
      locations: Array.from(allLocationsMap.values()),
    };
  } catch (err: any) {
    console.error(`getPcoCampusesAndLocations error for org ${orgId}:`, err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'Failed to fetch PCO campuses and locations.');
  }
});

/**
 * Callable Cloud Function: assignDoorsToCampusLocation
 *
 * Assigns one or more doors to a campus and/or location/room.
 */
export const assignDoorsToCampusLocation = onCall<
  AssignDoorsRequest,
  Promise<{ success: boolean; count: number }>
>(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to assign doors.');
  }

  const tokenRole = (request.auth.token as any)?.role;
  const tokenOrgId = (request.auth.token as any)?.orgId;
  const orgId = request.data?.orgId || tokenOrgId;

  if (!orgId) {
    throw new HttpsError('invalid-argument', 'Organization ID is required.');
  }

  const { doorIds, campusId, campusName, locationId, locationName } = request.data;
  if (!Array.isArray(doorIds) || doorIds.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one door ID is required.');
  }

  const isSuperAdmin = tokenRole === 'super_admin';
  if (!isSuperAdmin) {
    const db = getFirestore();
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const membership = userDoc.data()?.org_memberships?.[orgId];
    const role = membership?.role || (tokenOrgId === orgId ? tokenRole : null);
    if (!role || !['org_admin', 'manager'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'You must be an org_admin or manager to assign door campuses.'
      );
    }
  }

  const db = getFirestore();
  const orgRef = db.collection('organizations').doc(orgId);
  const doorsRef = orgRef.collection('doors');

  const batch = db.batch();
  for (const dId of doorIds) {
    const doorDoc = doorsRef.doc(dId);
    batch.update(doorDoc, {
      campus_id: campusId || null,
      campus_name: campusName || null,
      location_id: locationId || null,
      location_name: locationName || null,
      updated_at: FieldValue.serverTimestamp(),
    });
  }

  // Audit log entry
  const auditRef = orgRef.collection('audit_logs').doc();
  batch.set(auditRef, {
    action: 'schedule_updated',
    triggered_by: 'manual',
    actor_uid: request.auth.uid,
    result: 'success',
    message: `Mapped ${doorIds.length} door(s) to Campus: "${campusName || 'None'}", Location: "${locationName || 'None'}"`,
    timestamp: new Date().toISOString(),
  });

  await batch.commit();

  return {
    success: true,
    count: doorIds.length,
  };
});
