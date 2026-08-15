import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface CreateOrganizationRequest {
  orgName: string;
  timezone: string;
}

interface CreateOrganizationResponse {
  orgId: string;
  success: true;
}

/**
 * Converts an organization name to a URL-safe lowercase slug.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Callable Cloud Function: createOrganization
 *
 * Creates a new organization document, default settings config,
 * and seeds the calling user as an org_admin with custom claims.
 */
export const createOrganization = onCall<
  CreateOrganizationRequest,
  Promise<CreateOrganizationResponse>
>(async (request) => {
  // Verify caller is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to create an organization.');
  }

  const { orgName, timezone } = request.data;
  const uid = request.auth.uid;

  // Validate inputs
  if (!orgName || typeof orgName !== 'string' || orgName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'orgName must be a non-empty string.');
  }
  if (!timezone || typeof timezone !== 'string') {
    throw new HttpsError('invalid-argument', 'timezone must be a non-empty string.');
  }

  const db = getFirestore();
  const auth = getAuth();

  // Generate a new Firestore document ID for the org
  const orgRef = db.collection('organizations').doc();
  const orgId = orgRef.id;
  const slug = toSlug(orgName);
  const now = FieldValue.serverTimestamp();

  // Run all writes in a batch for atomicity
  const batch = db.batch();

  // 1. Create the organization document
  batch.set(orgRef, {
    name: orgName.trim(),
    slug,
    created_at: now,
    pco_connected: false,
  });

  // 2. Create the settings/config document with defaults
  const configRef = orgRef.collection('settings').doc('config');
  batch.set(configRef, {
    unlock_buffer_before_min: 15,
    lock_buffer_after_min: 15,
    poll_interval_min: 30,
    timezone,
  });

  // 3. Create or update the user document with org_memberships
  const userRef = db.collection('users').doc(uid);
  batch.set(
    userRef,
    {
      org_memberships: {
        [orgId]: { role: 'org_admin', joined_at: now },
      },
    },
    { merge: true }
  );

  await batch.commit();

  // 4. Set custom claims on the Firebase Auth user
  await auth.setCustomUserClaims(uid, {
    orgId,
    role: 'org_admin',
  });

  return { orgId, success: true };
});
