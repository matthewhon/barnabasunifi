import { escapeHtml, formatDateInTz } from './baseLayout';

export function buildDailyScheduleSummaryEmail(params: {
  orgName: string;
  timezone: string;
  dateLabel: string;
  windows: Array<{
    title: string;
    unlockAt: string;
    lockAt: string;
    doorLabels: string[];
  }>;
  portalUrl?: string;
}) {
  const { orgName, timezone, dateLabel, windows, portalUrl } = params;
  const subject = `Today's Door Schedule (${windows.length} event${windows.length === 1 ? '' : 's'}) — ${orgName}`;

  const rowsHtml = windows
    .map((w) => {
      const unlockStr = formatDateInTz(w.unlockAt, timezone, 'h:mm a');
      const lockStr = formatDateInTz(w.lockAt, timezone, 'h:mm a');
      const doors = w.doorLabels.length > 0 ? w.doorLabels.join(', ') : 'None';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(w.title)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(unlockStr)} &ndash; ${escapeHtml(lockStr)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(doors)}</td>
        </tr>
      `;
    })
    .join('');

  const bodyHtml = `
    <p style="margin:0 0 14px 0;">
      Here is today's automated door unlock schedule for <strong>${escapeHtml(orgName)}</strong> (${escapeHtml(dateLabel)}):
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Event</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Unlock Window</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Doors</th>
      </tr>
      ${rowsHtml}
    </table>
  `;

  const textBody = [
    `Today's Door Schedule (${dateLabel}) — ${orgName}`,
    '',
    ...windows.map(
      (w) =>
        `- ${w.title}: ${formatDateInTz(w.unlockAt, timezone, 'h:mm a')} - ${formatDateInTz(w.lockAt, timezone, 'h:mm a')} (${w.doorLabels.join(', ')})`
    ),
  ].join('\n');

  return {
    subject,
    title: "Today's Door Schedule",
    preheader: `${windows.length} scheduled door window(s) today`,
    bodyHtml,
    textBody,
    cta: portalUrl ? { label: 'View Full Schedule', url: `${portalUrl}/schedule` } : undefined,
    tag: 'daily-door-schedule',
  };
}

export function buildDoorHeldAlertEmail(params: {
  orgName: string;
  doorLabel: string;
  reason: string;
  timezone: string;
  portalUrl?: string;
}) {
  const subject = `Security Alert: "${params.doorLabel}" ${params.reason} — ${params.orgName}`;
  const bodyHtml = `
    <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;">
      <strong>${escapeHtml(params.doorLabel)}</strong> is currently <strong>${escapeHtml(params.reason)}</strong>.
    </div>
    <p style="margin:0;color:#475569;font-size:13px;">
      Please check the Doors dashboard to verify whether this door should be locked.
    </p>
  `;
  const textBody = `Security Alert for ${params.orgName}: "${params.doorLabel}" is ${params.reason}.`;

  return {
    subject,
    title: 'Door Security Alert',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'View Doors', url: `${params.portalUrl}/doors` } : undefined,
    tag: 'door-held-alert',
  };
}

export function buildEventChangedEmail(params: {
  orgName: string;
  timezone: string;
  changes: Array<{
    title: string;
    changeType: 'rescheduled' | 'cancelled';
    oldStart: string;
    newStart: string;
    doorLabels: string[];
  }>;
  portalUrl?: string;
}) {
  const { orgName, timezone, changes, portalUrl } = params;
  const subject = `Urgent: ${changes.length} mapped event(s) changed within 48h — ${orgName}`;

  const rowsHtml = changes
    .map((c) => {
      const oldStr = formatDateInTz(c.oldStart, timezone);
      const newStr = c.changeType === 'cancelled' ? 'CANCELLED' : formatDateInTz(c.newStart, timezone);
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(c.title)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">${escapeHtml(oldStr)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#b91c1c;">${escapeHtml(newStr)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(c.doorLabels.join(', ') || '—')}</td>
        </tr>
      `;
    })
    .join('');

  const bodyHtml = `
    <p style="margin:0 0 14px 0;">
      Planning Center reported last-minute changes to the following mapped event(s) for <strong>${escapeHtml(orgName)}</strong>:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Event</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Previous</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Updated</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Doors</th>
      </tr>
      ${rowsHtml}
    </table>
  `;

  const textBody = changes
    .map((c) => `- ${c.title}: ${formatDateInTz(c.oldStart, timezone)} -> ${c.changeType === 'cancelled' ? 'CANCELLED' : formatDateInTz(c.newStart, timezone)}`)
    .join('\n');

  return {
    subject,
    title: 'Last-Minute Event Schedule Change',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: portalUrl ? { label: 'Review Schedule', url: `${portalUrl}/schedule` } : undefined,
    tag: 'pco-event-changed',
  };
}

export function buildVisitorArrivalEmail(params: {
  orgName: string;
  visitorName: string;
  doorLabel: string;
  arrivedAt: string;
  timezone: string;
  purpose?: string;
}) {
  const when = formatDateInTz(params.arrivedAt, params.timezone);
  const subject = `Visitor Arrived: ${params.visitorName} — ${params.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      <strong>${escapeHtml(params.visitorName)}</strong> just unlocked <strong>${escapeHtml(params.doorLabel)}</strong> at <strong>${escapeHtml(when)}</strong>.
    </p>
    ${params.purpose ? `<p style="margin:0;color:#475569;font-size:13px;"><strong>Purpose:</strong> ${escapeHtml(params.purpose)}</p>` : ''}
  `;
  const textBody = `Visitor Arrived: ${params.visitorName} unlocked ${params.doorLabel} at ${when}.`;

  return {
    subject,
    title: 'Visitor Arrival Notice',
    preheader: `${params.visitorName} arrived at ${params.doorLabel}`,
    bodyHtml,
    textBody,
    tag: 'visitor-arrival',
  };
}

export function buildVisitorExpiringEmail(params: {
  orgName: string;
  visitorName: string;
  endTime: string;
  timezone: string;
  doorLabels: string[];
  portalUrl?: string;
}) {
  const ends = formatDateInTz(params.endTime, params.timezone);
  const subject = `Visitor Pass Expiring Soon: ${params.visitorName} — ${params.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      The visitor access pass for <strong>${escapeHtml(params.visitorName)}</strong> (${escapeHtml(params.doorLabels.join(', ') || 'assigned doors')}) will expire at <strong>${escapeHtml(ends)}</strong>.
    </p>
    <p style="margin:0;color:#475569;font-size:13px;">
      If they still need building access, you can extend their pass from the Visitors page.
    </p>
  `;
  const textBody = `Visitor pass for ${params.visitorName} expires at ${ends}.`;

  return {
    subject,
    title: 'Visitor Pass Expiring Soon',
    preheader: `${params.visitorName}'s pass expires at ${ends}`,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'Manage Visitors', url: `${params.portalUrl}/visitors` } : undefined,
    tag: 'visitor-expiring',
  };
}

export function buildDeniedAccessAlertEmail(params: {
  orgName: string;
  actorName: string;
  doorLabel: string;
  method?: string;
  occurredAt: string;
  timezone: string;
  portalUrl?: string;
}) {
  const when = formatDateInTz(params.occurredAt, params.timezone);
  const subject = `Denied Access Attempt at ${params.doorLabel} — ${params.orgName}`;
  const bodyHtml = `
    <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;">
      An access attempt was <strong>denied</strong> at <strong>${escapeHtml(params.doorLabel)}</strong>.
    </div>
    <ul style="margin:8px 0 12px 20px;padding:0;">
      <li><strong>User / Credential:</strong> ${escapeHtml(params.actorName || 'Unknown')}</li>
      ${params.method ? `<li><strong>Method:</strong> ${escapeHtml(params.method)}</li>` : ''}
      <li><strong>Time:</strong> ${escapeHtml(when)}</li>
    </ul>
  `;
  const textBody = `Denied Access Attempt at ${params.doorLabel} (${when}) — User: ${params.actorName || 'Unknown'}.`;

  return {
    subject,
    title: 'Denied Access Attempt',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'View Activity Log', url: `${params.portalUrl}/activity` } : undefined,
    tag: 'denied-access-alert',
  };
}

export function buildUserSyncSummaryAlertEmail(params: {
  orgName: string;
  errorCount: number;
  revokedCount: number;
  portalUrl?: string;
}) {
  const subject = `PCO User Sync Notice (${params.errorCount} errors, ${params.revokedCount} revoked) — ${params.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      During the latest Planning Center user sync for <strong>${escapeHtml(params.orgName)}</strong>:
    </p>
    <ul style="margin:8px 0 12px 20px;padding:0;">
      ${params.errorCount > 0 ? `<li><strong>Provisioning Errors:</strong> ${params.errorCount} user(s) failed to sync</li>` : ''}
      ${params.revokedCount > 0 ? `<li><strong>Access Revoked:</strong> ${params.revokedCount} user(s) had policies removed after leaving mapped PCO Lists</li>` : ''}
    </ul>
  `;
  const textBody = `PCO User Sync for ${params.orgName}: ${params.errorCount} error(s), ${params.revokedCount} revocation(s).`;

  return {
    subject,
    title: 'PCO User Sync Notice',
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'View Synced Users', url: `${params.portalUrl}/mappings` } : undefined,
    tag: 'user-sync-alert',
  };
}

export function buildAgentUpdateAvailableEmail(params: {
  orgName: string;
  version: string;
  releaseNotes?: string;
  portalUrl?: string;
}) {
  const subject = `Local Agent Update Available (v${params.version}) — ${params.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      A new UnFi-PCO Local Agent release (<strong>v${escapeHtml(params.version)}</strong>) is available for <strong>${escapeHtml(params.orgName)}</strong>.
    </p>
    ${params.releaseNotes ? `<div style="margin:12px 0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">${escapeHtml(params.releaseNotes).replace(/\n/g, '<br/>')}</div>` : ''}
  `;
  const textBody = `Local Agent v${params.version} is available for ${params.orgName}.`;

  return {
    subject,
    title: `Agent v${params.version} Available`,
    preheader: subject,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'Update Agent in Settings', url: `${params.portalUrl}/settings` } : undefined,
    tag: 'agent-update-available',
  };
}

export function buildWeeklySecurityDigestEmail(params: {
  orgName: string;
  periodLabel: string;
  stats: {
    scheduledEvents: number;
    manualOverrides: number;
    failedCommands: number;
    visitorsIssued: number;
    deniedAccessAttempts: number;
  };
  portalUrl?: string;
}) {
  const { orgName, periodLabel, stats, portalUrl } = params;
  const subject = `Weekly Security & Facility Digest — ${orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      Here is your 7-day facility &amp; access summary for <strong>${escapeHtml(orgName)}</strong> (${escapeHtml(periodLabel)}):
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;">
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;">Scheduled Event Windows</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;">${stats.scheduledEvents}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;">Manual Door Commands</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;">${stats.manualOverrides}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;">Visitor Passes Created</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;">${stats.visitorsIssued}</td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;color:#64748b;">Failed Door Commands</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${stats.failedCommands > 0 ? '#b91c1c' : '#0f172a'};">${stats.failedCommands}</td></tr>
      <tr><td style="padding:10px 14px;color:#64748b;">Denied Access Attempts</td><td align="right" style="padding:10px 14px;font-weight:700;color:${stats.deniedAccessAttempts > 0 ? '#b45309' : '#0f172a'};">${stats.deniedAccessAttempts}</td></tr>
    </table>
  `;

  const textBody = [
    `Weekly Security & Facility Digest (${periodLabel}) — ${orgName}`,
    `Scheduled Event Windows: ${stats.scheduledEvents}`,
    `Manual Door Commands: ${stats.manualOverrides}`,
    `Visitor Passes Created: ${stats.visitorsIssued}`,
    `Failed Door Commands: ${stats.failedCommands}`,
    `Denied Access Attempts: ${stats.deniedAccessAttempts}`,
  ].join('\n');

  return {
    subject,
    title: 'Weekly Security & Facility Digest',
    preheader: `7-day summary for ${orgName}`,
    bodyHtml,
    textBody,
    cta: portalUrl ? { label: 'Open Analytics', url: `${portalUrl}/analytics` } : undefined,
    tag: 'weekly-security-digest',
  };
}
