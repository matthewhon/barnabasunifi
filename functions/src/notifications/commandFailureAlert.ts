import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getOrgAdminEmails, getOrgEmailContext, sendOrgEmail } from './postmark';
import { buildCommandFailureEmail } from './templates/alertEmails';

/**
 * Firestore Trigger: onDoorCommandFailed
 * Sends an email alert when a door command transitions to `status === 'failed'`
 * for organizations with `email_settings.notify_on_command_failure` enabled.
 */
export const onDoorCommandFailed = onDocumentUpdated(
  'organizations/{orgId}/door_commands/{commandId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || before?.status === 'failed' || after.status !== 'failed') {
      return;
    }

    const orgId = event.params.orgId;
    const orgCtx = await getOrgEmailContext(orgId);
    if (!orgCtx.emailSettings.notify_on_command_failure) {
      return;
    }

    let recipients = orgCtx.emailSettings.alert_recipients || [];
    if (recipients.length === 0) {
      recipients = await getOrgAdminEmails(orgId);
    }
    if (recipients.length === 0) return;

    const tmpl = buildCommandFailureEmail({
      orgName: orgCtx.orgName,
      action: String(after.action || 'door_command'),
      doorLabel: after.door_label as string | undefined,
      errorMessage: after.result_message as string | undefined,
      triggeredBy: String(after.triggered_by || 'scheduler'),
      occurredAt: String(after.executed_at || after.created_at || new Date().toISOString()),
      timezone: orgCtx.timezone,
      portalUrl: orgCtx.portalUrl || undefined,
    });

    await sendOrgEmail({
      orgId,
      to: recipients,
      ...tmpl,
    });
  }
);
