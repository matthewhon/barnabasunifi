/**
 * firebase/reconciliation.ts
 * Reconciles offline door actions to Firestore once internet connectivity is restored.
 */

import * as admin from 'firebase-admin';
import { getDb } from '../firebase';
import { logger } from '../logger';
import { getCacheStore, OfflineActionRecord } from '../storage/cacheStore';

/**
 * Reconcile all pending offline actions to Firestore.
 */
export async function reconcileOfflineActions(orgId: string, agentId: string): Promise<number> {
  const cacheStore = getCacheStore();
  const pendingActions = cacheStore.getPendingOfflineActions();

  if (pendingActions.length === 0) {
    return 0;
  }

  logger.info(
    `[Reconciliation] Found ${pendingActions.length} offline action(s) to reconcile with Firestore.`
  );

  const db = getDb();
  const successfulActionIds: string[] = [];

  for (const record of pendingActions) {
    try {
      const executedAtTimestamp = admin.firestore.Timestamp.fromDate(new Date(record.executed_at));
      const now = admin.firestore.Timestamp.now();

      // 1. Write Audit Log
      await db.collection(`organizations/${orgId}/audit_log`).add({
        action: record.action,
        door_id: record.door_id,
        door_label: record.door_label,
        schedule_window_id: record.schedule_window_id,
        status: record.status,
        result: record.status === 'done' ? 'success' : 'error',
        result_message: `${record.result_message} [Executed offline at ${record.executed_at}]`,
        message: `${record.result_message} [Executed offline at ${record.executed_at}]`,
        triggered_by: 'offline_scheduler',
        agent_id: agentId,
        org_id: orgId,
        executed_at: executedAtTimestamp,
        timestamp: executedAtTimestamp,
        reconciled_at: now,
      });

      // 2. Update Door state in Firestore
      const doorUpdate: Record<string, any> = {
        current_state: record.action === 'unlock' ? 'unlocked' : 'locked',
        last_synced: now,
      };
      if (record.action === 'unlock') {
        doorUpdate.last_unlocked_at = executedAtTimestamp;
        doorUpdate.is_held_unlocked = true;
        doorUpdate.unlock_trigger = 'offline_scheduler';
        if (record.duration_min) {
          doorUpdate.unlock_duration_min = record.duration_min;
          doorUpdate.hold_unlock_expires_at = admin.firestore.Timestamp.fromMillis(
            new Date(record.executed_at).getTime() + record.duration_min * 60 * 1000
          );
        }
      } else {
        doorUpdate.last_locked_at = executedAtTimestamp;
        doorUpdate.is_held_unlocked = false;
        doorUpdate.hold_unlock_expires_at = null;
        doorUpdate.unlock_duration_min = null;
      }
      await db.doc(`organizations/${orgId}/doors/${record.door_id}`).set(doorUpdate, { merge: true });

      // 3. Update Schedule Window document
      if (record.schedule_window_id) {
        try {
          const windowStatus = record.action === 'unlock'
            ? (record.status === 'done' ? 'unlocked' : 'unlock_failed')
            : (record.status === 'done' ? 'locked' : 'lock_failed');
          await db.doc(`organizations/${orgId}/schedule_windows/${record.schedule_window_id}`).update({
            status: windowStatus,
            last_command_status: record.status,
            last_updated: now,
          });
        } catch (wErr) {
          logger.debug(`[Reconciliation] Notice updating window ${record.schedule_window_id}: ${wErr}`);
        }
      }

      // 4. If any pending/queued door_commands exist for this window + door + action, mark done
      try {
        const matchingCommandsSnap = await db
          .collection(`organizations/${orgId}/door_commands`)
          .where('door_id', '==', record.door_id)
          .where('action', '==', record.action)
          .where('schedule_window_id', '==', record.schedule_window_id)
          .where('status', 'in', ['pending', 'queued'])
          .get();

        for (const cmdDoc of matchingCommandsSnap.docs) {
          await cmdDoc.ref.update({
            status: 'done',
            executed_at: executedAtTimestamp,
            result_message: 'Executed locally via offline autonomous scheduler.',
            agent_id: agentId,
          });
        }
      } catch (cmdErr) {
        logger.debug(`[Reconciliation] Notice updating matching commands: ${cmdErr}`);
      }

      successfulActionIds.push(record.id);
    } catch (itemErr) {
      logger.error(`[Reconciliation] Failed to reconcile action ${record.id}: ${String(itemErr)}`);
    }
  }

  if (successfulActionIds.length > 0) {
    cacheStore.clearFlushedOfflineActions(successfulActionIds);
    logger.info(
      `[Reconciliation] ✓ Successfully reconciled and cleared ${successfulActionIds.length} offline action(s).`
    );
  }

  return successfulActionIds.length;
}
