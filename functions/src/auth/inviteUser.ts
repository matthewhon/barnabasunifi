import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import * as crypto from 'crypto';

type Role = 'org_admin' | 'manager' | 'viewer';

interface InviteUserRequest {
  email: string;
  role: Role;
  orgId: string;
}

interface InviteUserResponse {
  success: true;
  uid: string;
}

/**
 * Generates a cryptographically random temporary password.
 */
function generateTempPassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Callable Cloud Function: inviteUser
 *
 * Allows an org_admin to invite a new user (by email) to their organization.
 * Creates a Firebase Auth user if one doesn't exist, sets custom claims,
 * and records the membership in Firestore.
 */
export const inviteUser = onCall<InviteUserRequest, Promise<InviteUserResponse>>(
  async (request) => {
    // Verify caller is authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to invite users.');
    }

    const callerClaims = request.auth.token;

    // Verify caller is an org_admin
    if (callerClaims.role !== 'org_admin') {
      throw new HttpsError(
        'permission-denied',
        'Only org admins can invite users.'
      );
    }

    const { email, role, orgId } = request.data;

    // Verify the caller is an admin of the org they are inviting to
    if (callerClaims.orgId !== orgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only invite users to your own organization.'
      );
    }

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid email address is required.');
    }
    const validRoles: Role[] = ['org_admin', 'manager', 'viewer'];
    if (!validRoles.includes(role)) {
      throw new HttpsError(
        'invalid-argument',
        `role must be one of: ${validRoles.join(', ')}.`
      );
    }

    const db = getFirestore();
    const auth = getAuth();

    let uid: string;

    // Try to find the user by email; create if not found
    try {
      const existingUser = await auth.getUserByEmail(email);
      uid = existingUser.uid;
    } catch (err: unknown) {
      // Firebase Auth throws an error with code 'auth/user-not-found'
      const isNotFound =
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'auth/user-not-found';

      if (!isNotFound) {
        throw new HttpsError('internal', 'Failed to look up user by email.');
      }

      // Create a new user with a temporary password
      const newUser = await auth.createUser({
        email,
        password: generateTempPassword(),
        emailVerified: false,
      });
      uid = newUser.uid;
    }

    // Set custom claims on the invited user
    await auth.setCustomUserClaims(uid, { orgId, role });

    const now = FieldValue.serverTimestamp();

    // Upsert the user's org_memberships in Firestore
    const userRef = db.collection('users').doc(uid);
    await userRef.set(
      {
        email,
        org_memberships: {
          [orgId]: { role, joined_at: now },
        },
      },
      { merge: true }
    );

    return { success: true, uid };
  }
);
