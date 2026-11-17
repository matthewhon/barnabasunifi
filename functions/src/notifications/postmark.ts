import { ServerClient, Message } from 'postmark';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getEmailPlatformConfig, EmailPlatformConfig } from '../config/emailPlatform';
import { OrgEmailSettings, OrgSettings } from '../types';
import { renderBaseEmailLayout } from './templates/baseLayout';

export interface OrgEmailContext {
  orgId: string;
  orgName: string;
  timezone: string;
  address?: string;
  emailSettings: OrgEmailSettings;
  portalUrl: string;
}

export interface SendOrgEmailOptions {
  orgId?: string;
  to: string | string[];
  subject: string;
  title: string;
  preheader?: string;
  bodyHtml: string;
  textBody: string;
  cta?: {
    label: string;
    url: string;
  };
  tag?: string;
  stream?: 'transactional' | 'digest';
  replyTo?: string;
  metadata?: Record<string, string>;
  attachments?: Array<{
    Name: string;
    Content: string;
    ContentType: string;
  }>;
}

export interface SendEmailResult {
  sent: boolean;
  skipped?: boolean;
  messageIds?: string[];
  error?: string;
}

function sanitizeDisplayName(name: string): string {
  return name.replace(/["<>\\]/g, '').trim() || 'UnFi-PCO';
}

function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    const clean = item.trim().toLowerCase();
    if (clean && clean.includes('@') && !seen.has(clean)) {
      seen.add(clean);
      result.push(item.trim());
    }
  }
  return result;
}

/**
 * Loads organization name, timezone, and tenant email branding/settings.
 */
export async function getOrgEmailContext(orgId: string): Promise<OrgEmailContext> {
  const db = getFirestore();
  const [orgSnap, configSnap, platformCfg] = await Promise.all([
    db.doc(`organizations/${orgId}`).get(),
    db.doc(`organizations/${orgId}/settings/config`).get(),
    getEmailPlatformConfig(),
  ]);

  const orgData = orgSnap.data() ?? {};
  const settingsData = (configSnap.data() ?? {}) as Partial<OrgSettings>;

  return {
    orgId,
    orgName: (orgData.name as string) || orgId,
    timezone: settingsData.timezone || 'America/Chicago',
    address: settingsData.address?.trim() || (orgData.address as string)?.trim() || undefined,
    emailSettings: settingsData.email_settings || {},
    portalUrl: platformCfg?.portal_url || '',
  };
}

/**
 * Resolves all org_admin email addresses for an organization as a fallback
 * when no custom alert_recipients are configured.
 */
export async function getOrgAdminEmails(orgId: string): Promise<string[]> {
  const db = getFirestore();
  const usersSnap = await db.collection('users').get();
  const emails: string[] = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const memberships = data.org_memberships;
    let isAdmin = false;

    if (Array.isArray(memberships)) {
      isAdmin = memberships.some(
        (m: { org_id?: string; role?: string }) => m.org_id === orgId && m.role === 'org_admin'
      );
    } else if (memberships && typeof memberships === 'object') {
      isAdmin = memberships[orgId]?.role === 'org_admin';
    }

    if (isAdmin && typeof data.email === 'string' && data.email.includes('@')) {
      emails.push(data.email.trim());
    }
  }

  return emails;
}

async function logEmailDelivery(params: {
  orgId?: string;
  recipients: string[];
  subject: string;
  tag?: string;
  status: 'sent' | 'failed' | 'skipped';
  messageIds?: string[];
  error?: string;
}): Promise<void> {
  try {
    const db = getFirestore();
    const collectionRef = params.orgId
      ? db.collection(`organizations/${params.orgId}/email_logs`)
      : db.collection('platform_email_logs');

    await collectionRef.add({
      recipients: params.recipients,
      subject: params.subject,
      tag: params.tag || 'general',
      status: params.status,
      message_ids: params.messageIds || [],
      error: params.error || null,
      created_at: new Date().toISOString(),
      created_at_server: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to write email_logs entry:', err);
  }
}

function buildFromHeader(platformCfg: EmailPlatformConfig, orgCtx?: OrgEmailContext): string {
  const displayName = sanitizeDisplayName(
    orgCtx?.emailSettings.from_name || orgCtx?.orgName || platformCfg.default_from_name || 'UnFi-PCO'
  );
  return `"${displayName}" <${platformCfg.default_from_email}>`;
}

/**
 * Sends a branded email via the platform-wide Postmark server, applying tenant
 * logo, display name, Reply-To, and footer when `orgId` is provided.
 * Uses Postmark batch sending automatically when multiple recipients are provided.
 */
export async function sendOrgEmail(opts: SendOrgEmailOptions): Promise<SendEmailResult> {
  const recipients = normalizeRecipients(opts.to);
  if (recipients.length === 0) {
    return { sent: false, skipped: true, error: 'No valid recipients provided.' };
  }

  const platformCfg = await getEmailPlatformConfig();
  if (!platformCfg) {
    console.warn(`[Postmark] Skipping email "${opts.subject}" — platform_config/email not configured.`);
    await logEmailDelivery({
      orgId: opts.orgId,
      recipients,
      subject: opts.subject,
      tag: opts.tag,
      status: 'skipped',
      error: 'Postmark not configured',
    });
    return { sent: false, skipped: true, error: 'Postmark is not configured.' };
  }

  const orgCtx = opts.orgId ? await getOrgEmailContext(opts.orgId) : undefined;
  const htmlBody = renderBaseEmailLayout({
    orgName: orgCtx?.orgName || platformCfg.default_from_name,
    logoUrl: orgCtx?.emailSettings.logo_url,
    title: opts.title,
    preheader: opts.preheader,
    bodyHtml: opts.bodyHtml,
    cta: opts.cta,
    footerText: orgCtx?.emailSettings.footer_text,
    portalUrl: platformCfg.portal_url,
  });

  const fromHeader = buildFromHeader(platformCfg, orgCtx);
  const replyTo = opts.replyTo || orgCtx?.emailSettings.reply_to || undefined;
  const messageStream =
    opts.stream === 'digest'
      ? platformCfg.digest_stream || platformCfg.transactional_stream || 'outbound'
      : platformCfg.transactional_stream || 'outbound';

  const client = new ServerClient(platformCfg.postmark_server_token);

  try {
    const messageIds: string[] = [];

    if (recipients.length === 1) {
      const payload: Message = {
        From: fromHeader,
        To: recipients[0],
        Subject: opts.subject,
        HtmlBody: htmlBody,
        TextBody: opts.textBody,
        MessageStream: messageStream,
        Tag: opts.tag,
        ...(replyTo ? { ReplyTo: replyTo } : {}),
        ...(opts.metadata ? { Metadata: opts.metadata } : {}),
        ...(opts.attachments && opts.attachments.length > 0
          ? { Attachments: opts.attachments.map((a) => ({ ...a, ContentID: null })) }
          : {}),
      };
      const res = await client.sendEmail(payload);
      if (res.MessageID) messageIds.push(res.MessageID);
    } else {
      // Send individual personalized-envelope messages in batches of up to 500
      for (let i = 0; i < recipients.length; i += 500) {
        const chunk = recipients.slice(i, i + 500);
        const batch: Message[] = chunk.map((recipient) => ({
          From: fromHeader,
          To: recipient,
          Subject: opts.subject,
          HtmlBody: htmlBody,
          TextBody: opts.textBody,
          MessageStream: messageStream,
          Tag: opts.tag,
          ...(replyTo ? { ReplyTo: replyTo } : {}),
          ...(opts.metadata ? { Metadata: opts.metadata } : {}),
          ...(opts.attachments && opts.attachments.length > 0
          ? { Attachments: opts.attachments.map((a) => ({ ...a, ContentID: null })) }
          : {}),
        }));
        const responses = await client.sendEmailBatch(batch);
        for (const r of responses) {
          if (r.MessageID) messageIds.push(r.MessageID);
        }
      }
    }

    await logEmailDelivery({
      orgId: opts.orgId,
      recipients,
      subject: opts.subject,
      tag: opts.tag,
      status: 'sent',
      messageIds,
    });

    return { sent: true, messageIds };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Postmark] Failed to send email "${opts.subject}":`, err);
    await logEmailDelivery({
      orgId: opts.orgId,
      recipients,
      subject: opts.subject,
      tag: opts.tag,
      status: 'failed',
      error: message,
    });
    return { sent: false, error: message };
  }
}
