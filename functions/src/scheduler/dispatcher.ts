import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandStatus = 'pending' | 'queued' | 'executing' | 'completed' | 'failed';

interface DoorCommand {
  window_id: string;
  action: 'unlock' | 'lock';
  execute_at: Timestamp;
  status: CommandStatus;
  created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// dispatchDoorCommands — Firestore onCreate trigger
// ---------------------------------------------------------------------------

/**
 * Firestore-triggered Cloud Function: dispatchDoorCommands
 *
 * Fires whenever a new document is created under
 * /organizations/{orgId}/door_commands/{commandId}.
 *
 * Logic:
 * - If execute_at is in the past (or within the next 60 seconds),
 *   immediately mark the command as 'queued' so the door agent can pick it up.
 * - Otherwise, leave the status as 'pending'; a time-based poller or
 *   Cloud Scheduler job will transition it when execution_at arrives.
 * - Always writes an audit log entry.
 */
export const dispatchDoorCommands = onDocumentCreated(
  '/organizations/{orgId}/door_commands/{commandId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      console.warn('dispatchDoorCommands: No snapshot data on event.');
      return;
    }

    const { orgId, commandId } = event.params;
    const command = snapshot.data() as DoorCommand;
    const db = getFirestore();

    const now = Date.now();
    // Convert Firestore Timestamp → ms
    const executeAtMs = command.execute_at instanceof Timestamp
      ? command.execute_at.toMillis()
      : Number(command.execute_at);

    // Window within which we treat the command as "now" (60 seconds)
    const IMMEDIATE_WINDOW_MS = 60 * 1000;
    const isImmediate = executeAtMs - now <= IMMEDIATE_WINDOW_MS;

    const commandRef = db
      .collection('organizations')
      .doc(orgId)
      .collection('door_commands')
      .doc(commandId);

    if (isImmediate) {
      // Mark as queued immediately so the door agent processes it
      await commandRef.update({
        status: 'queued' as CommandStatus,
        queued_at: FieldValue.serverTimestamp(),
      });

      console.log(
        `dispatchDoorCommands: [org=${orgId}] command=${commandId} ` +
          `action=${command.action} → status=queued (execute_at was immediate/past)`
      );
    } else {
      // Leave as 'pending'; log for observability
      const executeAtDate = new Date(executeAtMs).toISOString();
      console.log(
        `dispatchDoorCommands: [org=${orgId}] command=${commandId} ` +
          `action=${command.action} → status=pending (execute_at=${executeAtDate})`
      );
    }

    // Write an audit log entry for every door command creation
    await db
      .collection('organizations')
      .doc(orgId)
      .collection('audit_logs')
      .add({
        event: 'door_command_created',
        command_id: commandId,
        action: command.action,
        window_id: command.window_id ?? null,
        execute_at: command.execute_at,
        initial_status: isImmediate ? 'queued' : 'pending',
        logged_at: FieldValue.serverTimestamp(),
      });
  }
);
