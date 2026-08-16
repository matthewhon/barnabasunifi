import { getFirestore } from 'firebase-admin/firestore';

export interface PlatformConfig {
  pco_client_id: string;
  pco_client_secret: string;
  redirect_uri: string;
  updated_at: string;
  updated_by: string;
}

let cachedConfig: PlatformConfig | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads platform-level config (PCO OAuth credentials) from Firestore.
 * Results are cached in memory for 5 minutes to reduce Firestore reads.
 * Uses Admin SDK so it bypasses Firestore security rules.
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiry) {
    return cachedConfig;
  }

  const db = getFirestore();
  const snap = await db.collection('platform_config').doc('pco').get();

  if (!snap.exists) {
    throw new Error(
      'Platform PCO config not found in Firestore (platform_config/pco). ' +
      'Please configure it in the Admin > Platform Config page.',
    );
  }

  cachedConfig = snap.data() as PlatformConfig;
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedConfig;
}

/** Invalidate the in-memory cache (call after updating credentials via admin UI) */
export function invalidatePlatformConfigCache(): void {
  cachedConfig = null;
  cacheExpiry = 0;
}
