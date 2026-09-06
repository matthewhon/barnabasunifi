import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { PcoClient, PcoResource } from './client';

type ResourceType = 'services' | 'groups' | 'service' | 'group';

interface GetPcoResourcesRequest {
  orgId?: string;
  type: ResourceType;
}

interface FormattedPcoTime {
  id: string;
  name?: string;
  starts_at: string;
  ends_at?: string;
  time_type?: string;
}

interface FormattedPcoResource {
  id: string;
  name: string;
  type: string;
  frequency?: string;
  schedule?: string;
  description?: string;
  upcoming_plan_title?: string;
  upcoming_plan_date?: string;
  upcoming_times?: FormattedPcoTime[];
  attributes: Record<string, unknown>;
}

interface GetPcoResourcesResponse {
  items: FormattedPcoResource[];
  resources: FormattedPcoResource[];
}

/**
 * Callable Cloud Function: getPcoResources
 *
 * Fetches Planning Center service types or groups for the caller's organization,
 * including configured schedules and upcoming plan/event times.
 */
export const getPcoResources = onCall<
  GetPcoResourcesRequest,
  Promise<GetPcoResourcesResponse>
>(async (request) => {
  // Verify caller is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to fetch PCO resources.');
  }

  const { type, orgId: reqOrgId } = request.data ?? {};

  if (!['services', 'groups', 'service', 'group'].includes(type)) {
    throw new HttpsError('invalid-argument', "type must be one of: 'services', 'groups', 'service', 'group'.");
  }

  const tokenRole = (request.auth.token as any)?.role;
  const tokenOrgId = (request.auth.token as any)?.orgId;
  const targetOrgId = reqOrgId || tokenOrgId;

  if (!targetOrgId) {
    throw new HttpsError('invalid-argument', 'Organization ID is required.');
  }

  // Check authorization (super_admin, or org_admin/manager/viewer of targetOrgId)
  const isSuperAdmin = tokenRole === 'super_admin';
  if (!isSuperAdmin) {
    const db = getFirestore();
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    if (userData?.role !== 'super_admin') {
      const memberships = userData?.org_memberships;
      let role: string | undefined;
      if (Array.isArray(memberships)) {
        role = memberships.find((m: any) => m.org_id === targetOrgId)?.role;
      } else if (memberships && typeof memberships === 'object') {
        role = memberships[targetOrgId]?.role;
      }
      role = role || (tokenOrgId === targetOrgId ? tokenRole : userData?.role);
      if (!role || !['org_admin', 'manager', 'viewer'].includes(role)) {
        throw new HttpsError(
          'permission-denied',
          'You do not have permission to view PCO resources for this organization.'
        );
      }
    }
  }

  try {
    const client = new PcoClient(targetOrgId);
    await client.init();

    if (type === 'services' || type === 'service') {
      const rawItems: PcoResource[] = await client.getServiceTypes();

      const enrichedItems: FormattedPcoResource[] = await Promise.all(
        rawItems.map(async (item) => {
          const frequency = (item.attributes?.frequency ?? '') as string;
          let upcomingPlanTitle: string | undefined;
          let upcomingPlanDate: string | undefined;
          let upcomingTimes: FormattedPcoTime[] = [];

          try {
            const plans = await client.getPlansForServiceType(item.id, 60);
            if (plans && plans.length > 0) {
              const nextPlan = plans[0];
              upcomingPlanTitle = (nextPlan.attributes?.dates ?? nextPlan.attributes?.title ?? nextPlan.attributes?.series_title) as string | undefined;
              upcomingPlanDate = (nextPlan.attributes?.sort_date ?? nextPlan.attributes?.dates) as string | undefined;

              const planTimes = await client.getPlanTimes(item.id, nextPlan.id);
              upcomingTimes = planTimes.map((pt) => {
                const attrs = pt.attributes as { starts_at?: string; ends_at?: string; time_type?: string; name?: string };
                return {
                  id: pt.id,
                  name: attrs.name,
                  starts_at: attrs.starts_at || '',
                  ends_at: attrs.ends_at,
                  time_type: attrs.time_type,
                };
              }).filter((t) => !!t.starts_at);
            }
          } catch (err) {
            console.warn(`Could not load upcoming plan times for service type ${item.id}:`, err);
          }

          return {
            id: item.id,
            name: (item.attributes?.name ?? item.attributes?.title ?? 'Unnamed') as string,
            type: item.type,
            frequency: frequency || undefined,
            upcoming_plan_title: upcomingPlanTitle,
            upcoming_plan_date: upcomingPlanDate,
            upcoming_times: upcomingTimes,
            attributes: item.attributes ?? {},
          };
        })
      );

      return { items: enrichedItems, resources: enrichedItems };
    } else {
      let rawItems: PcoResource[] = [];
      try {
        rawItems = await client.getGroups();
      } catch (err) {
        console.warn('getPcoResources: Groups API warning:', err);
        rawItems = [];
      }

      const enrichedItems: FormattedPcoResource[] = await Promise.all(
        rawItems.map(async (item) => {
          const schedule = (item.attributes?.schedule ?? '') as string;
          const description = (item.attributes?.description ?? '') as string;
          let upcomingTimes: FormattedPcoTime[] = [];

          try {
            const events = await client.getGroupEvents(item.id, 60);
            upcomingTimes = (events || []).slice(0, 5).map((ev) => {
              const attrs = ev.attributes as { starts_at?: string; ends_at?: string; name?: string; title?: string };
              return {
                id: ev.id,
                name: attrs.name ?? attrs.title ?? 'Group Event',
                starts_at: attrs.starts_at || '',
                ends_at: attrs.ends_at,
                time_type: 'event',
              };
            }).filter((t) => !!t.starts_at);
          } catch (err) {
            console.warn(`Could not load upcoming events for group ${item.id}:`, err);
          }

          return {
            id: item.id,
            name: (item.attributes?.name ?? item.attributes?.title ?? 'Unnamed') as string,
            type: item.type,
            schedule: schedule || undefined,
            description: description || undefined,
            upcoming_times: upcomingTimes,
            attributes: item.attributes ?? {},
          };
        })
      );

      return { items: enrichedItems, resources: enrichedItems };
    }
  } catch (err: any) {
    console.error(`getPcoResources error for org ${targetOrgId}:`, err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'Failed to fetch PCO resources.');
  }
});
