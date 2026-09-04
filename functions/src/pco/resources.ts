import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { PcoClient, PcoResource } from './client';

type ResourceType = 'services' | 'groups' | 'service' | 'group';

interface GetPcoResourcesRequest {
  orgId?: string;
  type: ResourceType;
}

interface FormattedPcoResource {
  id: string;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
}

interface GetPcoResourcesResponse {
  items: FormattedPcoResource[];
  resources: FormattedPcoResource[];
}

/**
 * Callable Cloud Function: getPcoResources
 *
 * Fetches Planning Center service types or groups for the caller's organization.
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

    let rawItems: PcoResource[] = [];

    switch (type) {
      case 'services':
      case 'service':
        rawItems = await client.getServiceTypes();
        break;
      case 'groups':
      case 'group':
        try {
          rawItems = await client.getGroups();
        } catch (err) {
          console.warn('getPcoResources: Groups API warning:', err);
          rawItems = [];
        }
        break;
      default:
        throw new HttpsError('invalid-argument', `Unknown resource type: ${type}`);
    }

    const items: FormattedPcoResource[] = rawItems.map((item) => ({
      id: item.id,
      name: (item.attributes?.name ?? item.attributes?.title ?? 'Unnamed') as string,
      type: item.type,
      attributes: item.attributes ?? {},
    }));

    return { items, resources: items };
  } catch (err: any) {
    console.error(`getPcoResources error for org ${targetOrgId}:`, err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err?.message || 'Failed to fetch PCO resources.');
  }
});
