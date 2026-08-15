import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { syncOrgSchedule } from './sync';

/**
 * Scheduled Cloud Function: scheduledPcoSync
 *
 * Runs every 30 minutes. Iterates over all organizations that have PCO
 * connected and calls `syncOrgSchedule` for each one.
 *
 * Failures in individual orgs are caught and logged so they don't prevent
 * other organizations from being synced.
 */
export const scheduledPcoSync = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeoutSeconds: 540, // 9 minutes — allow plenty of time for large installs
    memory: '512MiB',
  },
  async (_event) => {
    const db = getFirestore();

    // Fetch all orgs that have PCO connected
    const orgsSnap = await db
      .collection('organizations')
      .where('pco_connected', '==', true)
      .get();

    if (orgsSnap.empty) {
      console.log('scheduledPcoSync: No PCO-connected organizations found.');
      return;
    }

    console.log(`scheduledPcoSync: Syncing ${orgsSnap.docs.length} organization(s).`);

    const results = await Promise.allSettled(
      orgsSnap.docs.map(async (orgDoc) => {
        const orgId = orgDoc.id;
        const orgName = (orgDoc.data() as { name?: string }).name ?? orgId;

        try {
          const result = await syncOrgSchedule(orgId);
          console.log(
            `scheduledPcoSync: [${orgName}] ✓ windowsCreated=${result.windowsCreated} windowsUpdated=${result.windowsUpdated}`
          );
          return { orgId, ...result };
        } catch (err) {
          console.error(`scheduledPcoSync: [${orgName}] ✗ sync failed:`, err);
          throw err;
        }
      })
    );

    // Summarize outcome
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(
      `scheduledPcoSync: Complete — ${succeeded} succeeded, ${failed} failed out of ${results.length} orgs.`
    );
  }
);
