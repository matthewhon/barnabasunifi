import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import axios from 'axios';
import { getPlatformConfig } from '../config/platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PcoTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface PcoOAuthConfig {
  access_token: string;
  refresh_token: string;
  /** Unix timestamp (ms) when the access_token expires */
  expires_at: number;
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const PCO_TOKEN_URL = 'https://api.planningcenteronline.com/oauth/token';
const PCO_AUTHORIZE_URL = 'https://api.planningcenteronline.com/oauth/authorize';

// Credentials are loaded from Firestore platform_config/pco at runtime
async function getPcoCredentials() {
  const cfg = await getPlatformConfig();
  return {
    clientId: cfg.pco_client_id,
    clientSecret: cfg.pco_client_secret,
    redirectUri: cfg.redirect_uri,
  };
}

function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? 'https://barnabasunfi.web.app';
}

// ---------------------------------------------------------------------------
// Helper: refreshPcoToken
// ---------------------------------------------------------------------------

/**
 * Refreshes the PCO access token for a given org and writes the updated
 * tokens back to Firestore.  Returns the new access token.
 */
export async function refreshPcoToken(orgId: string): Promise<string> {
  const db = getFirestore();
  const configRef = db.collection('organizations').doc(orgId).collection('settings').doc('config');
  const configSnap = await configRef.get();

  if (!configSnap.exists) {
    throw new Error(`Settings config not found for org ${orgId}`);
  }

  const config = configSnap.data() as { pco_oauth?: PcoOAuthConfig };
  const oauth = config.pco_oauth;

  if (!oauth?.refresh_token) {
    throw new Error(`No PCO refresh token found for org ${orgId}`);
  }

  const { clientId, clientSecret } = await getPcoCredentials();

  const response = await axios.post<PcoTokenResponse>(
    PCO_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = response.data;
  const expires_at = Date.now() + expires_in * 1000;

  await configRef.update({
    pco_oauth: { access_token, refresh_token, expires_at },
  });

  return access_token;
}

// ---------------------------------------------------------------------------
// pcoOAuthStart — GET handler that redirects to PCO's authorization page
// ---------------------------------------------------------------------------

export const pcoOAuthStart = onRequest(async (req, res) => {
  const orgId = req.query['orgId'] as string | undefined;

  if (!orgId) {
    res.status(400).send('Missing required query parameter: orgId');
    return;
  }

  const { clientId, redirectUri } = await getPcoCredentials();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'services groups',
    state: orgId,
  });

  const authUrl = `${PCO_AUTHORIZE_URL}?${params.toString()}`;
  res.redirect(302, authUrl);
});

// ---------------------------------------------------------------------------
// pcoOAuthCallback — GET handler that exchanges code for tokens
// ---------------------------------------------------------------------------

export const pcoOAuthCallback = onRequest(async (req, res) => {
  const code = req.query['code'] as string | undefined;
  const orgId = req.query['state'] as string | undefined;

  if (!code || !orgId) {
    res.status(400).send('Missing required query parameters: code, state');
    return;
  }

  const db = getFirestore();

  try {
    const { clientId, clientSecret, redirectUri } = await getPcoCredentials();

    // Exchange authorization code for tokens
    const tokenResponse = await axios.post<PcoTokenResponse>(
      PCO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expires_at = Date.now() + expires_in * 1000;

    const orgRef = db.collection('organizations').doc(orgId);
    const configRef = orgRef.collection('settings').doc('config');

    // Persist tokens in Firestore
    await configRef.set(
      {
        pco_oauth: { access_token, refresh_token, expires_at },
        pco_oauth_updated_at: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Mark the organization as PCO-connected
    await orgRef.update({
      pco_connected: true,
      pco_connected_at: FieldValue.serverTimestamp(),
    });

    // Redirect user back to the app settings page
    const redirectUrl = `${getAppBaseUrl()}/settings?pco=connected`;
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('PCO OAuth callback error:', err);
    const redirectUrl = `${getAppBaseUrl()}/settings?pco=error`;
    res.redirect(302, redirectUrl);
  }
});
