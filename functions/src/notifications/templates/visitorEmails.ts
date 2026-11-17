import { escapeHtml, formatDateInTz } from './baseLayout';

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
}

export function buildVisitorPassEmail(v: VisitorEmailData, isUpdate = false) {
  const startFormatted = formatDateInTz(v.startTime, v.timezone);
  const endFormatted = formatDateInTz(v.endTime, v.timezone);
  const doorsText = v.doorLabels.length > 0 ? v.doorLabels.join(', ') : 'Assigned facility doors';

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
        <td style="padding:10px 14px;${v.purpose ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;">Authorized Doors</td>
        <td style="padding:10px 14px;${v.purpose ? 'border-bottom:1px solid #e2e8f0;' : ''}font-size:13px;font-weight:600;color:#0f172a;">${escapeHtml(doorsText)}</td>
      </tr>
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
