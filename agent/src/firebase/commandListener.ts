/**
 * firebase/commandListener.ts
 * Real-time Firestore listener for door commands.
 *
 * Listens for documents in organizations/{orgId}/door_commands with
 * status == 'queued' that are due for execution (execute_at <= now).
 * Uses Firestore transactions to claim commands atomically, preventing
 * double-execution in multi-agent deployments.
 */

import * as admin from 'firebase-admin';
import { getDb } from '../firebase';
import { UnifiAccessClient, UnifiVisitor } from '../unifi/access';
import { logger } from '../logger';

import { syncDoors } from './doorSync';
import { syncSchedules } from './scheduleSync';
import { syncVisitors } from './visitorSync';
import { syncAccessLogs } from './accessLogSync';
import { checkForUpdate, applyPendingUpdate } from './updateChecker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandAction =
  | 'unlock'
  | 'lock'
  | 'sync_doors'
  | 'sync_schedules'
  | 'update_schedule'
  | 'create_schedule'
  | 'delete_schedule'
  | 'sync_visitors'
  | 'create_visitor'
  | 'update_visitor'
  | 'delete_visitor'
  | 'sync_access_logs'
  | 'apply_update'
  | 'upgrade_agent';

export type CommandStatus =
  | 'queued'
  | 'executing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface DoorCommand {
  id: string;
  action: CommandAction;
  door_id?: string;
  door_label?: string;
  unifi_door_id?: string;
  schedule_id?: string;
  schedule_data?: Record<string, unknown>;
  visitor_id?: string;
  unifi_visitor_id?: string;
  firestore_visitor_id?: string;
  visitor_data?: Record<string, unknown>;
  status: CommandStatus;
  execute_at: FirebaseFirestore.Timestamp | string | Date;
  duration_min?: number;
  schedule_window_id?: string;
  triggered_by?: 'scheduler' | 'manual';
  actor_uid?: string;
  created_by?: string;
  org_id: string;
}

export type CommandCallback = (command: DoorCommand) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowTimestamp(): FirebaseFirestore.Timestamp {
  return admin.firestore.Timestamp.now();
}

function parseExecuteAtMillis(executeAt: unknown): number {
  if (!executeAt) return 0;
  if (typeof (executeAt as any).toMillis === 'function') {
    return (executeAt as any).toMillis();
  }
  if (executeAt instanceof Date) {
    return isNaN(executeAt.getTime()) ? 0 : executeAt.getTime();
  }
  if (typeof executeAt === 'string' || typeof executeAt === 'number') {
    const ms = new Date(executeAt).getTime();
    return isNaN(ms) ? 0 : ms;
  }
  return 0;
}

async function writeAuditLog(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  command: DoorCommand,
  status: CommandStatus,
  resultMessage: string,
  agentId: string
): Promise<void> {
  try {
    const isManual = command.triggered_by === 'manual' || !command.schedule_window_id;
    let action: string;
    if (command.action === 'unlock') {
      action = isManual ? 'manual_unlock' : 'unlock';
    } else if (command.action === 'lock') {
      action = isManual ? 'manual_lock' : 'lock';
    } else if (command.action === 'sync_doors') {
      action = 'doors_synced';
    } else if (command.action === 'sync_schedules') {
      action = 'schedule_synced';
    } else if (command.action === 'update_schedule') {
      action = 'schedule_updated';
    } else if (command.action === 'create_schedule') {
      action = 'schedule_created';
    } else if (command.action === 'delete_schedule') {
      action = 'schedule_deleted';
    } else if (command.action === 'sync_visitors') {
      action = 'visitor_synced';
    } else if (command.action === 'create_visitor') {
      action = 'visitor_created';
    } else if (command.action === 'update_visitor') {
      action = 'visitor_updated';
    } else if (command.action === 'delete_visitor') {
      action = 'visitor_deleted';
    } else if (command.action === 'sync_access_logs') {
      action = 'access_logs_synced';
    } else {
      action = command.action;
    }

    await db.collection(`organizations/${orgId}/audit_log`).add({
      command_id: command.id,
      action,
      door_id: command.door_id ?? null,
      door_label: command.door_label ?? null,
      unifi_door_id: command.unifi_door_id ?? null,
      schedule_id: command.schedule_id ?? null,
      status,
      result: status === 'done' ? 'success' : 'error',
      result_message: resultMessage,
      message: resultMessage,
      triggered_by: isManual ? 'manual' : 'scheduler',
      actor_uid: command.actor_uid ?? null,
      agent_id: agentId,
      org_id: orgId,
      schedule_window_id: command.schedule_window_id ?? null,
      executed_at: nowTimestamp(),
      timestamp: nowTimestamp(),
    });
  } catch (err) {
    logger.error(`Failed to write audit log for command ${command.id}: ${String(err)}`);
  }
}

async function updateScheduleWindow(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  windowId: string,
  action: CommandAction,
  status: CommandStatus
): Promise<void> {
  try {
    const windowRef = db.doc(`organizations/${orgId}/schedule_windows/${windowId}`);
    const windowStatus = action === 'unlock'
      ? (status === 'done' ? 'unlocked' : 'unlock_failed')
      : (status === 'done' ? 'locked' : 'lock_failed');

    await windowRef.update({
      status: windowStatus,
      last_command_status: status,
      last_updated: nowTimestamp(),
    });
  } catch (err) {
    logger.warn(
      `Could not update schedule_window ${windowId}: ${String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Start listening for queued door commands and execute them against the
 * UniFi Access API. Returns an unsubscribe function.
 *
 * @param orgId       - Firestore organization document ID
 * @param agentId     - This agent's identifier (written into executed commands)
 * @param unifiClient - Initialized UniFi Access client
 * @param onCommand   - Optional callback invoked whenever a command is processed
 */
export function startCommandListener(
  orgId: string,
  agentId: string,
  unifiClient: UnifiAccessClient,
  onCommand?: CommandCallback
): () => void {
  const db = getDb();
  const commandsRef = db.collection(`organizations/${orgId}/door_commands`);
  const activeTimers = new Map<string, NodeJS.Timeout>();

  logger.info(`[CommandListener] Watching commands for org: ${orgId}`);

  async function processCommand(doc: FirebaseFirestore.DocumentSnapshot) {
    const commandId = doc.id;
    const rawData = doc.data();
    if (!rawData) return;

    // Step 1: Atomically claim the command with a Firestore transaction
    let command: DoorCommand;
    try {
      const claimed = await db.runTransaction(async (tx) => {
        const freshDoc = await tx.get(doc.ref);
        if (!freshDoc.exists) return false;

        const freshData = freshDoc.data()!;
        if (freshData.status !== 'queued') return false;

        tx.update(doc.ref, {
          status: 'executing',
          agent_id: agentId,
          claimed_at: nowTimestamp(),
        });
        return true;
      });

      if (!claimed) {
        logger.debug(
          `[CommandListener] Command ${commandId} already claimed or not queued — skipping.`
        );
        return;
      }

      const unifiDoorId = (rawData.unifi_door_id || rawData.door_id) as string | undefined;

      command = {
        id: commandId,
        action: rawData.action as CommandAction,
        door_id: rawData.door_id as string | undefined,
        door_label: rawData.door_label as string | undefined,
        unifi_door_id: unifiDoorId,
        schedule_id: rawData.schedule_id as string | undefined,
        schedule_data: rawData.schedule_data as Record<string, unknown> | undefined,
        visitor_id: rawData.visitor_id as string | undefined,
        unifi_visitor_id: rawData.unifi_visitor_id as string | undefined,
        firestore_visitor_id: rawData.firestore_visitor_id as string | undefined,
        visitor_data: rawData.visitor_data as Record<string, unknown> | undefined,
        status: 'executing',
        execute_at: rawData.execute_at,
        duration_min: rawData.duration_min as number | undefined,
        schedule_window_id: rawData.schedule_window_id as string | undefined,
        triggered_by: rawData.triggered_by as 'scheduler' | 'manual' | undefined,
        actor_uid: rawData.actor_uid as string | undefined,
        created_by: rawData.created_by as string | undefined,
        org_id: orgId,
      };

      logger.info(
        `[CommandListener] Claimed command ${commandId}: ${command.action}${
          command.unifi_door_id ? ` door ${command.unifi_door_id}` : ''
        }${command.schedule_id ? ` schedule ${command.schedule_id}` : ''}${
          command.visitor_id ? ` visitor ${command.visitor_id}` : ''
        }`
      );
    } catch (err) {
      logger.error(
        `[CommandListener] Transaction failed for command ${commandId}: ${String(err)}`
      );
      return;
    }

    // Step 2: Execute the command against the UniFi Access API
    let finalStatus: CommandStatus = 'done';
    let resultMessage = '';

    try {
      if (command.action === 'unlock') {
        if (!command.unifi_door_id) throw new Error('Missing unifi_door_id for unlock action');
        const durationMin = command.duration_min ?? 60;
        await unifiClient.unlockDoor(command.unifi_door_id, durationMin);
        resultMessage = `Door unlocked for ${durationMin} minute(s).`;
        syncDoors(orgId, unifiClient).catch(() => {});
      } else if (command.action === 'lock') {
        if (!command.unifi_door_id) throw new Error('Missing unifi_door_id for lock action');
        await unifiClient.lockDoor(command.unifi_door_id);
        resultMessage = 'Door locked successfully.';
        syncDoors(orgId, unifiClient).catch(() => {});
      } else if (command.action === 'sync_doors') {
        const synced = await syncDoors(orgId, unifiClient);
        resultMessage = `Discovered and synced ${synced.length} door(s) from UniFi Access.`;
      } else if (command.action === 'sync_schedules') {
        const synced = await syncSchedules(orgId, unifiClient);
        resultMessage = `Synced ${synced.length} schedule(s) from UniFi Access.`;
      } else if (command.action === 'update_schedule') {
        if (!command.schedule_id) throw new Error('Missing schedule_id for update_schedule');
        const updated = await unifiClient.updateSchedule(
          command.schedule_id,
          command.schedule_data || {}
        );
        await db.doc(`organizations/${orgId}/unifi_schedules/${command.schedule_id}`).set(
          {
            ...updated,
            org_id: orgId,
            last_synced: nowTimestamp(),
            sync_status: 'synced',
            sync_error: null,
            updated_at: nowTimestamp(),
          },
          { merge: true }
        );
        resultMessage = `Schedule ${command.schedule_id} updated successfully.`;
      } else if (command.action === 'create_schedule') {
        const created = await unifiClient.createSchedule(command.schedule_data || {});
        await db.doc(`organizations/${orgId}/unifi_schedules/${created.id}`).set(
          {
            ...created,
            org_id: orgId,
            last_synced: nowTimestamp(),
            sync_status: 'synced',
            sync_error: null,
            updated_at: nowTimestamp(),
          },
          { merge: true }
        );
        resultMessage = `Schedule ${created.id} created successfully.`;
      } else if (command.action === 'delete_schedule') {
        if (!command.schedule_id) throw new Error('Missing schedule_id for delete_schedule');
        await unifiClient.deleteSchedule(command.schedule_id);
        await db.doc(`organizations/${orgId}/unifi_schedules/${command.schedule_id}`).delete();
        resultMessage = `Schedule ${command.schedule_id} deleted successfully.`;
      } else if (command.action === 'sync_visitors') {
        const synced = await syncVisitors(orgId, unifiClient);
        resultMessage = `Synced ${synced.length} visitor(s) from UniFi Access.`;
      } else if (command.action === 'create_visitor' || command.action === 'update_visitor') {
        const rawUnifiId = (command.visitor_data?.unifi_visitor_id as string) || (command.unifi_visitor_id as string);
        const unifiVisitorId = (rawUnifiId && rawUnifiId !== command.visitor_id) ? rawUnifiId : undefined;
        let resultVisitor: UnifiVisitor;

        if (command.action === 'update_visitor' && unifiVisitorId) {
          try {
            resultVisitor = await unifiClient.updateVisitor(unifiVisitorId, command.visitor_data || {});
            resultMessage = `Visitor ${command.visitor_id} updated successfully in UniFi.`;
          } catch (updateErr: any) {
            const errStr = String(updateErr);
            if (errStr.includes('160001') || errStr.includes('not found') || updateErr?.response?.status === 404) {
              logger.warn(`[CommandListener] Visitor ${unifiVisitorId} not found in UniFi. Creating new visitor…`);
              resultVisitor = await unifiClient.createVisitor(command.visitor_data || {});
              resultMessage = `Visitor created in UniFi (ID: ${resultVisitor.id}).`;
            } else {
              throw updateErr;
            }
          }
        } else {
          resultVisitor = await unifiClient.createVisitor(command.visitor_data || {});
          resultMessage = `Visitor ${resultVisitor.full_name || resultVisitor.first_name} created successfully in UniFi.`;
        }

        const targetVisitorId = command.visitor_id || resultVisitor.id;
        await db.doc(`organizations/${orgId}/visitors/${targetVisitorId}`).set(
          {
            ...resultVisitor,
            id: targetVisitorId,
            org_id: orgId,
            unifi_visitor_id: resultVisitor.unifi_visitor_id || resultVisitor.id,
            last_synced: nowTimestamp(),
            sync_status: 'synced',
            sync_error: null,
            updated_at: nowTimestamp(),
          },
          { merge: true }
        );
      } else if (command.action === 'delete_visitor') {
        if (!command.visitor_id) throw new Error('Missing visitor_id for delete_visitor');
        const unifiVisitorId = (command.visitor_data?.unifi_visitor_id as string) || (command.unifi_visitor_id as string);
        if (unifiVisitorId && unifiVisitorId !== command.visitor_id) {
          try {
            await unifiClient.deleteVisitor(unifiVisitorId);
          } catch (delErr: any) {
            logger.warn(`[CommandListener] UniFi deleteVisitor notice: ${delErr.message}`);
          }
        }
        await db.doc(`organizations/${orgId}/visitors/${command.visitor_id}`).set(
          {
            status: 'revoked',
            sync_status: 'synced',
            updated_at: nowTimestamp(),
          },
          { merge: true }
        );
        resultMessage = `Visitor ${command.visitor_id} revoked successfully.`;
      } else if (command.action === 'sync_access_logs') {
        const synced = await syncAccessLogs(orgId, unifiClient);
        resultMessage = `Synced ${synced.length} access log(s) from UniFi Access.`;
      } else if (command.action === 'apply_update' || command.action === 'upgrade_agent') {
        const updateState = await checkForUpdate();
        if (updateState.updateAvailable) {
          applyPendingUpdate().catch((err) => {
            logger.error(`[CommandListener] Apply update failed: ${String(err)}`);
          });
          resultMessage = `Agent update to v${updateState.latestVersion} initiated. Restarting...`;
        } else {
          resultMessage = `Agent is already up to date (v${updateState.currentVersion}).`;
        }
      } else {
        throw new Error(`Unknown action: ${String((command as any).action)}`);
      }

      // Immediately update the door's state in Firestore so the dashboard reflects the change
      const targetDoorId = command.door_id || command.unifi_door_id;
      if (targetDoorId && (command.action === 'unlock' || command.action === 'lock')) {
        try {
          const newCurrentState = command.action === 'unlock' ? 'unlocked' : 'locked';
          const updateData: Record<string, any> = {
            current_state: newCurrentState,
            last_synced: nowTimestamp(),
          };
          if (command.action === 'unlock') {
            updateData.last_unlocked_at = nowTimestamp();
          } else {
            updateData.last_locked_at = nowTimestamp();
          }
          await db.doc(`organizations/${orgId}/doors/${targetDoorId}`).set(updateData, { merge: true });
        } catch (doorUpdateErr) {
          logger.warn(`Could not update door document state: ${String(doorUpdateErr)}`);
        }

        // Trigger background sync to refresh full door info without blocking
        syncDoors(orgId, unifiClient).catch((err) => {
          logger.debug(`[CommandListener] Post-command door sync notice: ${String(err)}`);
        });
      }

      logger.info(
        `[CommandListener] Command ${commandId} executed successfully: ${resultMessage}`
      );
    } catch (err) {
      finalStatus = 'failed';
      resultMessage = String(err);
      logger.error(
        `[CommandListener] Command ${commandId} failed: ${resultMessage}`
      );
    }

    // Step 3: Update the command document with the final status
    try {
      await doc.ref.update({
        status: finalStatus,
        executed_at: nowTimestamp(),
        result_message: resultMessage,
        agent_id: agentId,
      });
    } catch (err) {
      logger.error(
        `[CommandListener] Failed to update command ${commandId} status: ${String(err)}`
      );
    }

    // Step 4: Write audit log entry
    await writeAuditLog(db, orgId, command, finalStatus, resultMessage, agentId);

    // Step 5: Update the associated schedule window if applicable
    if (command.schedule_window_id) {
      await updateScheduleWindow(
        db,
        orgId,
        command.schedule_window_id,
        command.action,
        finalStatus
      );
    }

    // Invoke optional callback
    onCommand?.(command);
  }

  const query = commandsRef.where('status', '==', 'queued');

  const unsubscribe = query.onSnapshot(
    async (snapshot) => {
      const nowMs = Date.now();

      for (const docChange of snapshot.docChanges()) {
        const doc = docChange.doc;
        const commandId = doc.id;

        if (docChange.type === 'removed') {
          const timer = activeTimers.get(commandId);
          if (timer) {
            clearTimeout(timer);
            activeTimers.delete(commandId);
          }
          continue;
        }

        const rawData = doc.data();
        if (rawData.status !== 'queued') {
          const timer = activeTimers.get(commandId);
          if (timer) {
            clearTimeout(timer);
            activeTimers.delete(commandId);
          }
          continue;
        }

        const executeAtMs = parseExecuteAtMillis(rawData.execute_at);
        const delayMs = executeAtMs - nowMs;

        // If due now or past due (or within 5 seconds in future)
        if (delayMs <= 5000) {
          const timer = activeTimers.get(commandId);
          if (timer) {
            clearTimeout(timer);
            activeTimers.delete(commandId);
          }
          void processCommand(doc);
        } else if (delayMs < 24 * 60 * 60 * 1000) {
          // Schedule execution if not already scheduled
          if (!activeTimers.has(commandId)) {
            logger.info(
              `[CommandListener] Scheduling command ${commandId} in ${Math.round(delayMs / 1000)}s`
            );
            const timer = setTimeout(() => {
              activeTimers.delete(commandId);
              void processCommand(doc);
            }, delayMs);
            activeTimers.set(commandId, timer);
          }
        }
      }
    },
    (err) => {
      logger.error(`[CommandListener] Snapshot listener error: ${String(err)}`);
    }
  );

  return () => {
    for (const timer of activeTimers.values()) {
      clearTimeout(timer);
    }
    activeTimers.clear();
    unsubscribe();
  };
}
