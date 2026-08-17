import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

interface CreateOrganizationRequest {
  orgName: string;
  displayName?: string;
  timezone?: string;
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

  const { orgName, displayName, timezone } = request.data;
  const uid = request.auth.uid;
  const email = request.auth.token.email ?? '';

  // Validate inputs
  if (!orgName || typeof orgName !== 'string' || orgName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Organization name must be a non-empty string.');
  }
  const resolvedTimezone = timezone && typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'America/Chicago';

  try {
    const db = getFirestore();
    const auth = getAuth();

    // Generate a new Firestore document ID for the org
    const orgRef = db.collection('organizations').doc();
    const orgId = orgRef.id;
    const slug = toSlug(orgName);
    const now = FieldValue.serverTimestamp();

    // Fetch existing user doc if any
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const existingUserData = userSnap.exists ? userSnap.data() : {};
    const existingMemberships = existingUserData?.org_memberships;

    const mergedMemberships =
      typeof existingMemberships === 'object' && !Array.isArray(existingMemberships)
        ? { ...existingMemberships, [orgId]: { role: 'org_admin', joined_at: now } }
        : { [orgId]: { role: 'org_admin', joined_at: now } };

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
      timezone: resolvedTimezone,
    });

    // 3. Upsert the user profile document with org_memberships
    batch.set(
      userRef,
      {
        uid,
        email: email || existingUserData?.email || '',
        display_name: displayName?.trim() || existingUserData?.display_name || request.auth.token.name || 'Admin',
        org_memberships: mergedMemberships,
        created_at: existingUserData?.created_at ?? now,
      },
      { merge: true }
    );

    await batch.commit();

    // 4. Set custom claims on the Firebase Auth user.
    // Firestore rules authorize off these claims, so an org whose creator has no
    // claims is unreachable. Undo the batch rather than stranding a half-built org
    // that the user can see in their memberships but can never read.
    try {
      // The creator is always the org's admin. Preserve super_admin in the claim
      // itself, though — overwriting it with 'org_admin' would silently strip
      // platform-wide access from anyone who creates an org for a tenant.
      await auth.setCustomUserClaims(uid, {
        orgId,
        role: request.auth.token.role === 'super_admin' ? 'super_admin' : 'org_admin',
      });
    } catch (claimsErr) {
      const rollback = db.batch();
      rollback.delete(configRef);
      rollback.delete(orgRef);
      rollback.update(userRef, { [`org_memberships.${orgId}`]: FieldValue.delete() });
      await rollback.commit().catch((rollbackErr) => {
        console.error('Rollback after setCustomUserClaims failure also failed:', rollbackErr);
      });
      throw claimsErr;
    }

    return { orgId, success: true };
  } catch (err: unknown) {
    console.error('Error in createOrganization Cloud Function:', err);
    if (err instanceof HttpsError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'An error occurred while creating the organization.';
    throw new HttpsError('internal', message);
  }
});
