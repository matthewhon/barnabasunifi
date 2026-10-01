/**
 * One-time migration: addRehearsalToMappings
 *
 * For every mapping document (in /organizations/{orgId}/mappings,
 * service_mappings, and group_mappings) that has time_types = ['service']
 * (i.e., service was the only enabled type), this script adds 'rehearsal'
 * so that rehearsal plan times are now included in door unlock windows.
 *
 * Safe to re-run — it skips any document that already includes 'rehearsal'.
 *
 * Usage (from the /functions directory):
 *   npx ts-node -e "require('./src/migrations/addRehearsalToMappings').runMigration().catch(console.error)"
 *
 * Or compile first:
 *   npm run build && node lib/migrations/addRehearsalToMappings.js
 */

import * as admin from 'firebase-admin';

// Initialize Admin SDK only if not already initialized (e.g. when run standalone)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAPPING_COLLECTIONS = ['mappings', 'service_mappings', 'group_mappings'];

export async function runMigration(): Promise<void> {
  console.log('=== addRehearsalToMappings migration starting ===');

  const orgsSnap = await db.collection('organizations').get();
  if (orgsSnap.empty) {
    console.log('No organizations found. Nothing to migrate.');
    return;
  }

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id;
    console.log(`\nOrg: ${orgId}`);

    for (const collName of MAPPING_COLLECTIONS) {
      const collRef = orgDoc.ref.collection(collName);
      const snap = await collRef.get();

      if (snap.empty) continue;

      for (const mappingDoc of snap.docs) {
        totalChecked++;
        const data = mappingDoc.data();
        const timeTypes: string[] = Array.isArray(data.time_types) ? data.time_types : [];

        // Only update mappings that have 'service' but are missing 'rehearsal'.
        // Mappings with an empty array already match all types — leave them alone.
        // Group mappings don't use time_types — leave them alone too.
        if (timeTypes.length === 0) {
          totalSkipped++;
          continue; // Already matches all types
        }

        const hasService = timeTypes.includes('service');
        const hasRehearsal = timeTypes.includes('rehearsal');

        if (!hasService || hasRehearsal) {
          totalSkipped++;
          continue; // Nothing to add
        }

        // Add 'rehearsal' to the existing list, preserving other entries
        const updatedTimeTypes = [...timeTypes, 'rehearsal'];
        await mappingDoc.ref.update({ time_types: updatedTimeTypes });

        console.log(
          `  [${collName}] ${mappingDoc.id}: time_types ${JSON.stringify(timeTypes)} → ${JSON.stringify(updatedTimeTypes)}`
        );
        totalUpdated++;
      }
    }
  }

  console.log('\n=== Migration complete ===');
  console.log(`  Documents checked : ${totalChecked}`);
  console.log(`  Documents updated : ${totalUpdated}`);
  console.log(`  Documents skipped : ${totalSkipped}`);
}

// Allow running directly via ts-node or compiled node
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
