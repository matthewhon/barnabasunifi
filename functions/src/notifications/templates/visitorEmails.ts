import { escapeHtml, formatDateInTz } from './baseLayout';

export interface VisitorDoorLocationInfo {
  label: string;
  address?: string;
  campusName?: string;
  locationName?: string;
}

export interface VisitorEmailData {
  fullName: string;
  firstName?: string;
  email: string;
  pinCode?: string;
  startTime: string;
  endTime: string;
  doorLabels: string[];
  purpose?: string;
  timezone: string;
  orgName: string;
  address?: string;
  doorLocations?: VisitorDoorLocationInfo[];
}

function formatVisitorLocationLines(v: VisitorEmailData): string[] {
  const doorAddresses = (v.doorLocations || [])
    .map((dl) => {
      const addr = dl.address?.trim();
      const sub = [dl.campusName, dl.locationName].filter(Boolean).join(' · ');
      if (addr && sub) return `${dl.label}: ${addr} (${sub})`;
      if (addr) return `${dl.label}: ${addr}`;
      return null;
    })
    .filter((x): x is string => Boolean(x));

  if (doorAddresses.length > 0) {
    // If all doors share the same address string and there's only one unique address, collapse it cleanly
    const uniqueRaw = Array.from(
      new Set((v.doorLocations || []).map((d) => d.address?.trim()).filter(Boolean))
    );
    if (uniqueRaw.length === 1 && doorAddresses.length === (v.doorLocations || []).length) {
      return [uniqueRaw[0]!];
    }
    return doorAddresses;
  }

  return v.address?.trim() ? [v.address.trim()] : [];
}

export function buildVisitorPassEmail(v: VisitorEmailData, isUpdate = false) {
  const startFormatted = formatDateInTz(v.startTime, v.timezone);
  const endFormatted = formatDateInTz(v.endTime, v.timezone);
  const doorsText = v.doorLabels.length > 0 ? v.doorLabels.join(', ') : 'Assigned facility doors';
  const locationLines = formatVisitorLocationLines(v);
  const hasLocation = locationLines.length > 0;

  const pinBlock = v.pinCode
    ? `
      <div style="margin:18px 0;padding:16px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;text-align:center;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1d4ed8;margin-bottom:4px;">Your Door Access PIN</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:0.22em;color:#0f172a;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">
          ${escapeHtml(v.pinCode)}
        </div>
      </div>
    `
    : '';

  const subject = isUpdate
    ? `Updated Visitor Access Pass — ${v.orgName}`
    : `Your Visitor Access Pass — ${v.orgName}`;

  const title = isUpdate ? 'Visitor Access Pass Updated' : 'Your Visitor Access Pass';

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(v.firstName || v.fullName)},</p>
    <p style="margin:0 0 16px 0;">
      ${isUpdate ? 'Your visitor access details for' : 'You have been issued a temporary visitor access pass for'} <strong>${escapeHtml(v.orgName)}</strong>.
    </p>
    ${pinBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin:12px 0;">
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;width:130px;">Valid From</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(startFormatted)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Valid Until</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(endFormatted)}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px;${v.purpose || hasLocation ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;">Authorized Doors</td>
        <td style="padding:10px 14px;${v.purpose || hasLocation ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(doorsText)}</td>
      </tr>
      ${hasLocation ? `
      <tr>
        <td style="padding:10px 14px;${v.purpose ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;vertical-align:top;">Location / Address</td>
        <td style="padding:10px 14px;${v.purpose ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#0f172a;">${locationLines.map((line) => escapeHtml(line)).join('<br/>')}</td>
      </tr>` : ''}
      ${v.purpose ? `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#64748b;">Purpose</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;">${escapeHtml(v.purpose)}</td>
      </tr>` : ''}
    </table>
    <p style="margin:14px 0 0 0;font-size:13px;color:#475569;">
      Please keep this pass confidential. Access automatically expires at the end time listed above.
    </p>
  `;

  const textBody = [
    `Hi ${v.firstName || v.fullName},`,
    '',
    `${isUpdate ? 'Updated' : 'New'} Visitor Access Pass for ${v.orgName}`,
    v.pinCode ? `PIN Code: ${v.pinCode}` : '',
    `Valid From: ${startFormatted}`,
    `Valid Until: ${endFormatted}`,
    `Authorized Doors: ${doorsText}`,
    hasLocation ? `Location / Address: ${locationLines.join(' | ')}` : '',
    v.purpose ? `Purpose: ${v.purpose}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title,
    preheader: v.pinCode ? `Your PIN is ${v.pinCode} for ${v.orgName}` : `Visitor pass for ${v.orgName}`,
    bodyHtml,
    textBody,
    tag: isUpdate ? 'visitor-pass-updated' : 'visitor-pass',
  };
}

export function buildVisitorRevokedEmail(v: {
  fullName: string;
  firstName?: string;
  orgName: string;
  startTime: string;
  timezone: string;
}) {
  const startFormatted = formatDateInTz(v.startTime, v.timezone);
  const subject = `Visitor Access Cancelled — ${v.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(v.firstName || v.fullName)},</p>
    <p style="margin:0 0 12px 0;">
      Your scheduled visitor access pass for <strong>${escapeHtml(v.orgName)}</strong> (${escapeHtml(startFormatted)}) has been cancelled.
    </p>
    <p style="margin:0;color:#475569;">If you believe this was in error, please reply to this email.</p>
  `;
  const textBody = `Hi ${v.firstName || v.fullName},\n\nYour visitor access pass for ${v.orgName} (${startFormatted}) has been cancelled.`;

  return {
    subject,
    title: 'Visitor Access Cancelled',
    preheader: `Visitor pass cancelled for ${v.orgName}`,
    bodyHtml,
    textBody,
    tag: 'visitor-pass-revoked',
  };
}

export function buildVisitorHostAlertEmail(v: VisitorEmailData & { actorEmail?: string; isUpdate?: boolean }) {
  const startFormatted = formatDateInTz(v.startTime, v.timezone);
  const endFormatted = formatDateInTz(v.endTime, v.timezone);
  const doorsText = v.doorLabels.length > 0 ? v.doorLabels.join(', ') : 'None specified';

  const subject = `Visitor ${v.isUpdate ? 'Updated' : 'Registered'}: ${v.fullName} — ${v.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      A visitor pass has been ${v.isUpdate ? 'updated' : 'created'} for <strong>${escapeHtml(v.fullName)}</strong>${v.actorEmail ? ` by ${escapeHtml(v.actorEmail)}` : ''}.
    </p>
    <ul style="margin:8px 0 12px 20px;padding:0;">
      <li><strong>Email:</strong> ${escapeHtml(v.email || 'Not provided')}</li>
      <li><strong>Window:</strong> ${escapeHtml(startFormatted)} &ndash; ${escapeHtml(endFormatted)}</li>
      <li><strong>Doors:</strong> ${escapeHtml(doorsText)}</li>
      ${v.purpose ? `<li><strong>Purpose:</strong> ${escapeHtml(v.purpose)}</li>` : ''}
    </ul>
  `;
  const textBody = [
    `Visitor ${v.isUpdate ? 'Updated' : 'Registered'}: ${v.fullName}`,
    `Window: ${startFormatted} - ${endFormatted}`,
    `Doors: ${doorsText}`,
    v.purpose ? `Purpose: ${v.purpose}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: `Visitor ${v.isUpdate ? 'Updated' : 'Registered'}`,
    preheader: `${v.fullName} (${startFormatted})`,
    bodyHtml,
    textBody,
    tag: 'visitor-host-alert',
  };
}

function formatIcsUtc(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function buildVisitorCalendarIcs(v: VisitorEmailData & { uid?: string }) {
  const dtStart = formatIcsUtc(v.startTime);
  const dtEnd = formatIcsUtc(v.endTime);
  const dtStamp = formatIcsUtc(new Date().toISOString());
  const uid = `${v.uid || `visitor-${Date.now()}`}@unfi-pco`;
  const doorsText = v.doorLabels.length > 0 ? v.doorLabels.join(', ') : 'Assigned facility doors';

  const descParts = [
    v.pinCode ? `Door Access PIN: ${v.pinCode}` : '',
    `Authorized Doors: ${doorsText}`,
    v.purpose ? `Purpose: ${v.purpose}` : '',
  ].filter(Boolean);

  const locationLines = formatVisitorLocationLines(v);
  const icsLocation = locationLines.length > 0 ? locationLines.join(' | ') : v.orgName;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UnFi-PCO//Visitor Access//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(`Visitor Access — ${v.orgName}`)}`,
    `DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`,
    `LOCATION:${escapeIcsText(icsLocation)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const content = Buffer.from(lines.join('\r\n'), 'utf8').toString('base64');
  return {
    Name: 'visitor-pass.ics',
    Content: content,
    ContentType: 'text/calendar; charset=utf-8; method=PUBLISH',
  };
}

export function buildVisitorRequestInviteEmail(opts: {
  orgName: string;
  recipientName?: string;
  inviterEmail?: string;
  inviteNote?: string;
  requestUrl: string;
  expiresAt: string;
  timezone: string;
}) {
  const expiresFormatted = formatDateInTz(opts.expiresAt, opts.timezone);
  const greeting = opts.recipientName ? `Hi ${escapeHtml(opts.recipientName)},` : 'Hello,';
  const subject = `Visitor Access Request Form — ${opts.orgName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">${greeting}</p>
    <p style="margin:0 0 14px 0;">
      ${opts.inviterEmail ? `<strong>${escapeHtml(opts.inviterEmail)}</strong> has invited` : 'You have been invited'} to submit visitor access details for <strong>${escapeHtml(opts.orgName)}</strong>.
    </p>
    ${opts.inviteNote ? `
      <div style="margin:12px 0;padding:12px 14px;background-color:#f8fafc;border-left:3px solid #2563eb;border-radius:4px;font-size:13px;color:#334155;">
        ${escapeHtml(opts.inviteNote)}
      </div>
    ` : ''}
    <p style="margin:0 0 12px 0;font-size:13px;color:#475569;">
      Once you submit the form, an administrator will review and approve the request, and the visitor will receive their timing and door PIN automatically.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;">
      This form link expires on ${escapeHtml(expiresFormatted)}.
    </p>
  `;

  const textBody = [
    opts.recipientName ? `Hi ${opts.recipientName},` : 'Hello,',
    '',
    `You have been invited to submit visitor access details for ${opts.orgName}.`,
    opts.inviteNote ? `Note: ${opts.inviteNote}` : '',
    `Form Link: ${opts.requestUrl}`,
    `Expires: ${expiresFormatted}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: 'Visitor Access Request',
    preheader: `Submit visitor details for ${opts.orgName}`,
    bodyHtml,
    textBody,
    cta: {
      label: 'Fill Out Visitor Form',
      url: opts.requestUrl,
    },
    tag: 'visitor-request-invite',
  };
}

export function buildVisitorRequestSubmittedAdminEmail(opts: {
  orgName: string;
  visitorName: string;
  visitorEmail: string;
  requesterName: string;
  requesterEmail: string;
  startTime: string;
  endTime: string;
  purpose: string;
  doorLabels: string[];
  timezone: string;
  reviewUrl?: string;
  isReminder?: boolean;
}) {
  const startFormatted = formatDateInTz(opts.startTime, opts.timezone);
  const endFormatted = formatDateInTz(opts.endTime, opts.timezone);
  const doorsText = opts.doorLabels.length > 0 ? opts.doorLabels.join(', ') : 'To be assigned by approver';
  const subject = opts.isReminder
    ? `Reminder: Pending Visitor Approval (${opts.visitorName}) — ${opts.orgName}`
    : `Visitor Approval Needed: ${opts.visitorName} — ${opts.orgName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      ${opts.isReminder ? '<strong>Reminder:</strong> A visitor request is starting soon and still awaiting approval.' : 'A new visitor access request has been submitted and requires your review.'}
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin:12px 0;">
      <tr>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;width:130px;">Visitor</td>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(opts.visitorName)} (${escapeHtml(opts.visitorEmail)})</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Requested By</td>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${escapeHtml(opts.requesterName)} (${escapeHtml(opts.requesterEmail)})</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Window</td>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(startFormatted)} &ndash; ${escapeHtml(endFormatted)}</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Doors</td>
        <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${escapeHtml(doorsText)}</td>
      </tr>
      <tr>
        <td style="padding:9px 14px;font-size:13px;color:#64748b;">Purpose</td>
        <td style="padding:9px 14px;font-size:13px;color:#0f172a;">${escapeHtml(opts.purpose)}</td>
      </tr>
    </table>
  `;

  const textBody = [
    opts.isReminder ? 'REMINDER: Pending Visitor Approval' : 'New Visitor Approval Needed',
    `Visitor: ${opts.visitorName} (${opts.visitorEmail})`,
    `Requested By: ${opts.requesterName} (${opts.requesterEmail})`,
    `Window: ${startFormatted} - ${endFormatted}`,
    `Doors: ${doorsText}`,
    `Purpose: ${opts.purpose}`,
    opts.reviewUrl ? `Review: ${opts.reviewUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: opts.isReminder ? 'Pending Visitor Approval Reminder' : 'Visitor Approval Needed',
    preheader: `${opts.visitorName} (${startFormatted})`,
    bodyHtml,
    textBody,
    ...(opts.reviewUrl ? { cta: { label: 'Review & Approve', url: opts.reviewUrl } } : {}),
    tag: opts.isReminder ? 'visitor-request-reminder' : 'visitor-request-pending',
  };
}

export function buildVisitorRequestReceiptEmail(opts: {
  orgName: string;
  requesterName: string;
  visitorName: string;
  startTime: string;
  endTime: string;
  timezone: string;
}) {
  const startFormatted = formatDateInTz(opts.startTime, opts.timezone);
  const endFormatted = formatDateInTz(opts.endTime, opts.timezone);
  const subject = `Visitor Request Received: ${opts.visitorName} — ${opts.orgName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(opts.requesterName)},</p>
    <p style="margin:0 0 12px 0;">
      Your visitor access request for <strong>${escapeHtml(opts.visitorName)}</strong> at <strong>${escapeHtml(opts.orgName)}</strong> has been submitted for approval.
    </p>
    <p style="margin:0 0 12px 0;font-size:13px;color:#475569;">
      <strong>Requested Window:</strong> ${escapeHtml(startFormatted)} &ndash; ${escapeHtml(endFormatted)}
    </p>
    <p style="margin:0;font-size:13px;color:#475569;">
      You will receive an email once an administrator reviews your request, and the visitor will be sent their access timing and PIN upon approval.
    </p>
  `;

  const textBody = `Hi ${opts.requesterName},\n\nYour visitor request for ${opts.visitorName} at ${opts.orgName} (${startFormatted} - ${endFormatted}) has been submitted for approval.`;

  return {
    subject,
    title: 'Visitor Request Submitted',
    preheader: `Request submitted for ${opts.visitorName}`,
    bodyHtml,
    textBody,
    tag: 'visitor-request-receipt',
  };
}

export function buildVisitorRequestApprovedRequesterEmail(opts: {
  orgName: string;
  requesterName: string;
  visitorName: string;
  startTime: string;
  endTime: string;
  doorLabels: string[];
  timezone: string;
  pendingSync?: boolean;
}) {
  const startFormatted = formatDateInTz(opts.startTime, opts.timezone);
  const endFormatted = formatDateInTz(opts.endTime, opts.timezone);
  const doorsText = opts.doorLabels.length > 0 ? opts.doorLabels.join(', ') : 'Assigned facility doors';
  const subject = `Visitor Request Approved: ${opts.visitorName} — ${opts.orgName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(opts.requesterName)},</p>
    <p style="margin:0 0 12px 0;">
      Your visitor access request for <strong>${escapeHtml(opts.visitorName)}</strong> at <strong>${escapeHtml(opts.orgName)}</strong> has been <strong>approved</strong>.
    </p>
    <ul style="margin:8px 0 12px 20px;padding:0;font-size:13px;color:#0f172a;">
      <li><strong>Window:</strong> ${escapeHtml(startFormatted)} &ndash; ${escapeHtml(endFormatted)}</li>
      <li><strong>Doors:</strong> ${escapeHtml(doorsText)}</li>
    </ul>
    <p style="margin:0;font-size:13px;color:#475569;">
      ${opts.pendingSync
        ? 'The door controller is syncing the pass now; the visitor will receive their timing and PIN email as soon as sync completes.'
        : 'The visitor has been sent their access timing and PIN via email.'}
    </p>
  `;

  const textBody = `Hi ${opts.requesterName},\n\nYour visitor request for ${opts.visitorName} at ${opts.orgName} has been approved.\nWindow: ${startFormatted} - ${endFormatted}\nDoors: ${doorsText}`;

  return {
    subject,
    title: 'Visitor Request Approved',
    preheader: `Approved: ${opts.visitorName}`,
    bodyHtml,
    textBody,
    tag: 'visitor-request-approved',
  };
}

export function buildVisitorRequestRejectedRequesterEmail(opts: {
  orgName: string;
  requesterName: string;
  visitorName: string;
  reason?: string;
}) {
  const subject = `Visitor Request Not Approved: ${opts.visitorName} — ${opts.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(opts.requesterName)},</p>
    <p style="margin:0 0 12px 0;">
      Your visitor access request for <strong>${escapeHtml(opts.visitorName)}</strong> at <strong>${escapeHtml(opts.orgName)}</strong> was not approved.
    </p>
    ${opts.reason ? `
      <div style="margin:12px 0;padding:12px 14px;background-color:#fef2f2;border-left:3px solid #ef4444;border-radius:4px;font-size:13px;color:#7f1d1d;">
        <strong>Reason:</strong> ${escapeHtml(opts.reason)}
      </div>
    ` : ''}
    <p style="margin:0;font-size:13px;color:#475569;">Please reply to this email if you need to submit an updated request.</p>
  `;

  const textBody = `Hi ${opts.requesterName},\n\nYour visitor request for ${opts.visitorName} at ${opts.orgName} was not approved.${opts.reason ? `\nReason: ${opts.reason}` : ''}`;

  return {
    subject,
    title: 'Visitor Request Not Approved',
    preheader: `Not approved: ${opts.visitorName}`,
    bodyHtml,
    textBody,
    tag: 'visitor-request-rejected',
  };
}

export function buildVisitorSyncFailedAdminEmail(opts: {
  orgName: string;
  visitorName: string;
  errorMessage: string;
  portalUrl?: string;
}) {
  const subject = `Action Required: Visitor Sync Failed (${opts.visitorName}) — ${opts.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      The local UniFi Access agent failed to create the approved visitor <strong>${escapeHtml(opts.visitorName)}</strong> for <strong>${escapeHtml(opts.orgName)}</strong>.
    </p>
    <p style="margin:0 0 12px 0;font-size:13px;color:#b91c1c;">
      <strong>Error:</strong> ${escapeHtml(opts.errorMessage)}
    </p>
    <p style="margin:0;font-size:13px;color:#475569;">
      Because sync failed, the visitor's PIN email was <strong>not</strong> sent. Please check the agent status and retry from the Visitors page.
    </p>
  `;
  const textBody = `Visitor sync failed for ${opts.visitorName} (${opts.orgName}): ${opts.errorMessage}. The PIN email was not sent.`;

  return {
    subject,
    title: 'Visitor Sync Failed',
    preheader: `Failed to sync ${opts.visitorName}`,
    bodyHtml,
    textBody,
    ...(opts.portalUrl ? { cta: { label: 'Open Visitors', url: `${opts.portalUrl}/visitors` } } : {}),
    tag: 'visitor-sync-failed',
  };
}

export function buildVisitorFirstArrivalEmail(opts: {
  orgName: string;
  visitorName: string;
  doorLabel: string;
  arrivedAt: string;
  timezone: string;
}) {
  const arrivedFormatted = formatDateInTz(opts.arrivedAt, opts.timezone);
  const subject = `Visitor Arrived: ${opts.visitorName} — ${opts.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      <strong>${escapeHtml(opts.visitorName)}</strong> has just arrived and unlocked <strong>${escapeHtml(opts.doorLabel)}</strong>.
    </p>
    <p style="margin:0;font-size:13px;color:#475569;">
      <strong>Time:</strong> ${escapeHtml(arrivedFormatted)}
    </p>
  `;
  const textBody = `${opts.visitorName} has arrived and unlocked ${opts.doorLabel} at ${arrivedFormatted}.`;

  return {
    subject,
    title: 'Visitor Arrived',
    preheader: `${opts.visitorName} unlocked ${opts.doorLabel}`,
    bodyHtml,
    textBody,
    tag: 'visitor-first-arrival',
  };
}
