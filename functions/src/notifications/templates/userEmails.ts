import { escapeHtml } from './baseLayout';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  org_admin: 'Organization Admin',
  manager: 'Manager',
  viewer: 'Viewer',
  camera_viewer: 'Camera Viewer',
};

export function buildUserInviteEmail(params: {
  orgName: string;
  role: string;
  setupLink: string;
  isNewUser: boolean;
}) {
  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const safeOrg = escapeHtml(params.orgName);
  const safeRole = escapeHtml(roleLabel);

  const subject = `You've been invited to ${params.orgName} on UnFi-PCO`;
  const title = params.isNewUser ? `Welcome to ${params.orgName}` : `You've been added to ${params.orgName}`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      You have been invited to join <strong>${safeOrg}</strong> on UnFi-PCO with the role of <strong>${safeRole}</strong>.
    </p>
    <p style="margin:0 0 12px 0;">
      Click the button below to set your password and activate your account:
    </p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <span style="word-break:break-all;color:#2563eb;">${escapeHtml(params.setupLink)}</span>
    </p>
  `;

  const textBody = [
    `You have been invited to join ${params.orgName} on UnFi-PCO as ${roleLabel}.`,
    '',
    `Set up your account here: ${params.setupLink}`,
  ].join('\n');

  return {
    subject,
    title,
    preheader: `Set up your ${params.orgName} account`,
    bodyHtml,
    textBody,
    cta: { label: 'Set Up Your Account', url: params.setupLink },
    tag: 'user-invite',
  };
}

export function buildPasswordResetEmail(params: {
  orgName: string;
  resetLink: string;
}) {
  const safeOrg = escapeHtml(params.orgName);
  const subject = `Reset your ${params.orgName} password`;
  const title = 'Password Reset Request';
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      An administrator for <strong>${safeOrg}</strong> initiated a password reset for your UnFi-PCO account.
    </p>
    <p style="margin:0 0 12px 0;">
      Click the button below to choose a new password. If you did not expect this email, you can safely ignore it.
    </p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#64748b;">
      Direct link: <span style="word-break:break-all;color:#2563eb;">${escapeHtml(params.resetLink)}</span>
    </p>
  `;

  const textBody = [
    `An administrator for ${params.orgName} initiated a password reset for your UnFi-PCO account.`,
    '',
    `Reset your password here: ${params.resetLink}`,
  ].join('\n');

  return {
    subject,
    title,
    preheader: `Reset your ${params.orgName} password`,
    bodyHtml,
    textBody,
    cta: { label: 'Reset Password', url: params.resetLink },
    tag: 'password-reset',
  };
}

export function buildRoleChangedEmail(params: {
  orgName: string;
  newRole: string;
  portalUrl?: string;
}) {
  const roleLabel = ROLE_LABELS[params.newRole] || params.newRole;
  const subject = `Your role in ${params.orgName} was updated`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      Your access role for <strong>${escapeHtml(params.orgName)}</strong> on UnFi-PCO has been updated to <strong>${escapeHtml(roleLabel)}</strong>.
    </p>
  `;
  const textBody = `Your access role for ${params.orgName} on UnFi-PCO has been updated to ${roleLabel}.`;

  return {
    subject,
    title: 'Account Role Updated',
    preheader: `Your role is now ${roleLabel}`,
    bodyHtml,
    textBody,
    cta: params.portalUrl ? { label: 'Open Portal', url: params.portalUrl } : undefined,
    tag: 'user-role-updated',
  };
}

export function buildUserRemovedEmail(params: { orgName: string }) {
  const subject = `Your access to ${params.orgName} has been removed`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      Your access to <strong>${escapeHtml(params.orgName)}</strong> on UnFi-PCO has been removed by an organization administrator.
    </p>
  `;
  const textBody = `Your access to ${params.orgName} on UnFi-PCO has been removed by an organization administrator.`;

  return {
    subject,
    title: 'Organization Access Removed',
    preheader: `Access removed for ${params.orgName}`,
    bodyHtml,
    textBody,
    tag: 'user-removed',
  };
}

export function buildSyncedUserWelcomeEmail(params: {
  orgName: string;
  firstName: string;
  policyNames: string[];
  listNames: string[];
}) {
  const policiesHtml = params.policyNames.length
    ? `<ul style="margin:8px 0 12px 20px;padding:0;">${params.policyNames
        .map((p) => `<li style="margin:4px 0;">${escapeHtml(p)}</li>`)
        .join('')}</ul>`
    : '<p style="margin:8px 0 12px 0;color:#64748b;">Standard building access</p>';

  const subject = `Your building access for ${params.orgName} is active`;
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${escapeHtml(params.firstName)},</p>
    <p style="margin:0 0 12px 0;">
      Your building door access for <strong>${escapeHtml(params.orgName)}</strong> has been provisioned based on your Planning Center group/list membership${params.listNames.length ? ` (${escapeHtml(params.listNames.join(', '))})` : ''}.
    </p>
    <p style="margin:0 0 4px 0;font-weight:600;color:#0f172a;">Assigned Access Policies:</p>
    ${policiesHtml}
    <p style="margin:12px 0 0 0;color:#475569;">
      If you need a keycard, mobile credential, or PIN configured, please reply to this email or contact your church office.
    </p>
  `;

  const textBody = [
    `Hi ${params.firstName},`,
    '',
    `Your building door access for ${params.orgName} is now active.`,
    params.policyNames.length ? `Assigned Access Policies: ${params.policyNames.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: 'Building Access Activated',
    preheader: `Your access for ${params.orgName} is active`,
    bodyHtml,
    textBody,
    tag: 'synced-user-welcome',
  };
}
