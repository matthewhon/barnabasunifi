#!/usr/bin/env node
/**
 * Script to grant full Super Admin privileges to a user.
 *
 * Usage:
 *   node scripts/setSuperAdmin.js [email]
 *
 * Example:
 *   node scripts/setSuperAdmin.js matthew.hon@honventures.com
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const targetEmail = process.argv[2] || 'matthew.hon@honventures.com';

// Attempt to load service account credentials if available
let app;
const possibleKeyPaths = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  path.join(__dirname, '../serviceAccountKey.json'),
  path.join(__dirname, '../service-account.json'),
  path.join(__dirname, '../functions/serviceAccountKey.json'),
];

const keyPath = possibleKeyPaths.find((p) => p && fs.existsSync(p));

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'barnabasunfi';

if (keyPath) {
  const serviceAccount = require(path.resolve(keyPath));
  app = initializeApp({
    credential: cert(serviceAccount),
    projectId,
  });
  console.log(`[SuperAdmin] Initialized Firebase Admin using service account: ${keyPath}`);
} else {
  // Use default application credentials with project ID
  app = initializeApp({
    projectId,
  });
  console.log(`[SuperAdmin] Initialized Firebase Admin for project: ${projectId}`);
}

const auth = getAuth(app);
const db = getFirestore(app);

async function makeSuperAdmin(email) {
  console.log(`\n========================================`);
  console.log(`Promoting "${email}" to SUPER ADMIN...`);
  console.log(`========================================\n`);

  try {
    // 1. Find user in Firebase Auth
    let user;
    try {
      user = await auth.getUserByEmail(email);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.error(`❌ User with email "${email}" was not found in Firebase Auth.`);
        console.log(`👉 Please have the user sign up / log in once first, then run this script again.`);
        process.exit(1);
      }
      throw err;
    }

    console.log(`✓ Found user in Firebase Auth: UID = ${user.uid}, Display Name = ${user.displayName || '(none)'}`);

    // 2. Set Custom User Claims on Firebase Auth token
    const existingClaims = user.customClaims || {};
    const updatedClaims = {
      ...existingClaims,
      role: 'super_admin',
    };

    await auth.setCustomUserClaims(user.uid, updatedClaims);
    console.log(`✓ Updated Firebase Auth Custom Claims: role = "super_admin"`);

    // 3. Update Firestore /users/{uid} document
    const userRef = db.collection('users').doc(user.uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      await userRef.update({
        role: 'super_admin',
        is_super_admin: true,
        updated_at: new Date().toISOString(),
      });
      console.log(`✓ Updated Firestore document /users/${user.uid} with role = "super_admin"`);
    } else {
      await userRef.set({
        uid: user.uid,
        email: user.email,
        display_name: user.displayName || user.email.split('@')[0],
        role: 'super_admin',
        is_super_admin: true,
        org_memberships: {},
        created_at: new Date().toISOString(),
      });
      console.log(`✓ Created Firestore document /users/${user.uid} with role = "super_admin"`);
    }

    console.log(`\n🎉 SUCCESS: ${email} is now a full Super Admin!`);
    console.log(`ℹ️  Note: If the user is currently logged in, they should sign out and sign back in (or refresh their session) to load the new claims.`);
  } catch (error) {
    console.error(`\n❌ Error making user super admin:`, error);
    process.exit(1);
  }
}

makeSuperAdmin(targetEmail).then(() => {
  process.exit(0);
});
