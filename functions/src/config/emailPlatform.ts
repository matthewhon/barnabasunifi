import { getFirestore } from 'firebase-admin/firestore';

export interface EmailPlatformConfig {
  postmark_server_token: string;
  default_from_email: string;
  default_from_name: string;
  transactional_stream?: string;
  digest_stream?: string;
  portal_url?: string;
  updated_at?: string;
  updated_by?: string;
}

let cachedEmailConfig: EmailPlatformConfig | null = null;
let emailCacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Loads platform-wide Postmark email configuration from Firestore (`platform_config/email`),
 * with optional fallback to `POSTMARK_SERVER_TOKEN` environment variable.
 * Returns null if not configured so callers can gracefully skip sending.
 */
export async function getEmailPlatformConfig(): Promise<EmailPlatformConfig | null> {
  const now = Date.now();
  if (cachedEmailConfig && now < emailCacheExpiry) {
    return cachedEmailConfig;
  }

  const db = getFirestore();
  const snap = await db.collection('platform_config').doc('email').get();

  const data = snap.exists ? (snap.data() as Partial<EmailPlatformConfig>) : {};
  const token = data.postmark_server_token || process.env.POSTMARK_SERVER_TOKEN || '';
  const fromEmail = data.default_from_email || process.env.POSTMARK_FROM_EMAIL || '';

  if (!token || !fromEmail) {
    return null;
  }

  cachedEmailConfig = {
    postmark_server_token: token,
    default_from_email: fromEmail,
    default_from_name: data.default_from_name || 'UnFi-PCO',
    transactional_stream: data.transactional_stream || 'outbound',
    digest_stream: data.digest_stream || data.transactional_stream || 'outbound',
    portal_url: data.portal_url || process.env.APP_URL || '',
    updated_at: data.updated_at,
    updated_by: data.updated_by,
  };
  emailCacheExpiry = now + CACHE_TTL_MS;
  return cachedEmailConfig;
}

/** Invalidate the in-memory email platform config cache. */
export function invalidateEmailPlatformConfigCache(): void {
  cachedEmailConfig = null;
  emailCacheExpiry = 0;
}
