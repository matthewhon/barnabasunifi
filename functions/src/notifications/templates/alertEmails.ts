import { escapeHtml, formatDateInTz } from './baseLayout';

export function buildAgentStatusEmail(params: {
  orgName: string;
  agentName: string;
  isOffline: boolean;
  lastHeartbeat?: string;
  timezone: string;
  portalUrl?: string;
}) {
  const { orgName, agentName, isOffline, lastHeartbeat, timezone, portalUrl } = params;
  const lastSeen = lastHeartbeat ? formatDateInTz(lastHeartbeat, timezone) : 'Unknown';

  const subject = isOffline
    ? `Alert: Local Agent "${agentName}" is OFFLINE — ${orgName}`
    : `Resolved: Local Agent "${agentName}" is back ONLINE — ${orgName}`;

  const title = isOffline ? 'Local Agent Offline' : 'Local Agent Back Online';
  const bodyHtml = isOffline
    ? `
      <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;">
        <strong>${escapeHtml(agentName)}</strong> has not checked in since <strong>${escapeHtml(lastSeen)}</strong>.
      </div>
      <p style="margin:0 0 12px 0;">
        While the on-premises agent is offline, scheduled door unlocks/locks and visitor updates for <strong>${escapeHtml(orgName)}</strong> cannot be delivered to your UniFi Access controller.
      </p>
      <p style="margin:0;color:#475569;font-size:13px;">
        Please verify the host machine / Docker container has power and internet connectivity.
      </p>
    `
    : `
      <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;color:#166534;">
        <strong>${escapeHtml(agentName)}</strong> reconnected at <strong>${escapeHtml(lastSeen)}</strong>.
      </div>
      <p style="margin:0;">Automated door scheduling and UniFi Access sync have resumed for <strong>${escapeHtml(orgName)}</strong>.</p>
    `;

  const textBody = isOffline
    ? `ALERT: Local Agent "${agentName}" for ${orgName} is OFFLINE (last heartbeat: ${lastSeen}).`
    : `RESOLVED: Local Agent "${agentName}" for ${orgName} is back ONLINE (${lastSeen}).`;

  return {
    subject,
    title,
    preheader: subject,
    bodyHtml,
    textBody,
    cta: portalUrl ? { label: 'Check Agent Status', url: `${portalUrl}/settings` } : undefined,
    tag: isOffline ? 'agent-offline' : 'agent-online',
  };
}

export function buildCommandFailureEmail(params: {
  orgName: string;
  action: string;
  doorLabel?: string;
  errorMessage?: string;
  triggeredBy: string;
  occurredAt: string;
  timezone: string;
  portalUrl?: string;
}) {
  const when = formatDateInTz(params.occurredAt, params.timezone);
  const subject = `Door Command Failed (${params.action}) — ${params.orgName}`;

  const bodyHtml = `
    <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;">
      A <strong>${escapeHtml(params.action)}</strong> command failed${params.doorLabel ? ` for <strong>${escapeHtml(params.doorLabel)}</strong>` : ''}.
    </div>
    <ul style="margin:8px 0 12px 20px;padding:0;">
      <li><strong>Triggered By:</strong> ${escapeHtml(params.triggeredBy)}</li>
      <li><strong>Time:</strong> ${escapeHtml(when)}</li>
      ${params.errorMessage ? `<li><strong>Error:</strong> ${escapeHtml(params.errorMessage)}</li>` : ''}
    </ul>
  `;

  const textBody = [
    `Door Command Failed (${params.action}) — ${params.orgName}`,
    params.doorLabel ? `Door: ${params.doorLabel}` : '',
    `Triggered By: ${params.triggeredBy}`,
    `Time: ${when}`,
    params.errorMessage ? `Error: ${params.errorMessage}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: 'Door Command Failed',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'View Activity Log', url: `${params.portalUrl}/activity` } : undefined,
    tag: 'door-command-failed',
  };
}

export function buildPcoSyncErrorEmail(params: {
  orgName: string;
  errorMessage: string;
  portalUrl?: string;
}) {
  const subject = `Planning Center Sync Error — ${params.orgName}`;
  const bodyHtml = `
    <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;">
      UnFi-PCO encountered an error while syncing Planning Center events for <strong>${escapeHtml(params.orgName)}</strong>.
    </div>
    <p style="margin:0 0 12px 0;font-size:13px;color:#334155;">
      <strong>Details:</strong> ${escapeHtml(params.errorMessage)}
    </p>
    <p style="margin:0;color:#475569;font-size:13px;">
      If your Planning Center OAuth connection expired, please reconnect in Settings &rarr; Planning Center.
    </p>
  `;
  const textBody = `Planning Center Sync Error for ${params.orgName}: ${params.errorMessage}`;

  return {
    subject,
    title: 'Planning Center Sync Error',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'Open Settings', url: `${params.portalUrl}/settings` } : undefined,
    tag: 'pco-sync-error',
  };
}
