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
import { UnifiAccessClient } from '../unifi/access';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoorAction = 'unlock' | 'lock';
export type CommandStatus =
  | 'queued'
  | 'executing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface DoorCommand {
  id: string;
  action: DoorAction;
  door_id: string;
  /** UniFi door UUID (may differ from Firestore door doc ID) */
  unifi_door_id: string;
  status: CommandStatus;
  execute_at: FirebaseFirestore.Timestamp | string | Date;
  duration_min?: number;
  schedule_window_id?: string;
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
    await db.collection(`organizations/${orgId}/audit_log`).add({
      command_id: command.id,
      action: command.action,
      door_id: command.door_id,
      unifi_door_id: command.unifi_door_id,
      status,
      result_message: resultMessage,
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
  action: DoorAction,
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

      const unifiDoorId = (rawData.unifi_door_id || rawData.door_id) as string;

      command = {
        id: commandId,
        action: rawData.action as DoorAction,
        door_id: rawData.door_id as string,
        unifi_door_id: unifiDoorId,
        status: 'executing',
        execute_at: rawData.execute_at,
        duration_min: rawData.duration_min as number | undefined,
        schedule_window_id: rawData.schedule_window_id as string | undefined,
        created_by: rawData.created_by as string | undefined,
        org_id: orgId,
      };

      logger.info(
        `[CommandListener] Claimed command ${commandId}: ${command.action} door ${command.unifi_door_id}`
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
        const durationMin = command.duration_min ?? 60;
        await unifiClient.unlockDoor(command.unifi_door_id, durationMin);
        resultMessage = `Door unlocked for ${durationMin} minute(s).`;
      } else if (command.action === 'lock') {
        await unifiClient.lockDoor(command.unifi_door_id);
        resultMessage = 'Door locked successfully.';
      } else {
        throw new Error(`Unknown action: ${String((command as DoorCommand).action)}`);
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
