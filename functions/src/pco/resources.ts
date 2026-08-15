import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { PcoClient, PcoResource } from './client';

type ResourceType = 'services' | 'groups';

interface GetPcoResourcesRequest {
  type: ResourceType;
}

interface GetPcoResourcesResponse {
  items: PcoResource[];
}

/**
 * Callable Cloud Function: getPcoResources
 *
 * Fetches Planning Center service types or groups for the caller's organization.
 * Requires the caller to have the role 'org_admin' or 'manager'.
 */
export const getPcoResources = onCall<
  GetPcoResourcesRequest,
  Promise<GetPcoResourcesResponse>
>(async (request) => {
  // Verify caller is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to fetch PCO resources.');
  }

  const { role, orgId } = request.auth.token as { role?: string; orgId?: string };

  // Verify caller has sufficient permissions
  if (!role || !['org_admin', 'manager'].includes(role)) {
    throw new HttpsError(
      'permission-denied',
      'You must be an org_admin or manager to fetch PCO resources.'
    );
  }

  if (!orgId) {
    throw new HttpsError('failed-precondition', 'Your account is not associated with an organization.');
  }

  const { type } = request.data;

  if (!['services', 'groups'].includes(type)) {
    throw new HttpsError('invalid-argument', "type must be one of: 'services', 'groups'.");
  }

  const client = new PcoClient(orgId);
  await client.init();

  let items: PcoResource[];

  switch (type) {
    case 'services':
      items = await client.getServiceTypes();
      break;
    case 'groups':
      items = await client.getGroups();
      break;
    default:
      throw new HttpsError('invalid-argument', `Unknown resource type: ${type}`);
  }

  return { items };
});
