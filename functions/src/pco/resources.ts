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

  const token = request.auth.token as { role?: string; orgId?: string };
  let targetOrgId = reqOrgId ?? token.orgId;
  let userRole = token.role;

  // Fallback to Firestore user doc if token custom claims are missing
  if (!userRole || !targetOrgId) {
    const db = getFirestore();
    const userSnap = await db.collection('users').doc(request.auth.uid).get();
    if (userSnap.exists) {
      const userData = userSnap.data();
      userRole = userRole ?? userData?.role;
      targetOrgId = targetOrgId ?? userData?.org_id;
    }
  }

  if (!targetOrgId) {
    throw new HttpsError('failed-precondition', 'Your account is not associated with an organization.');
  }

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
});
