import { NextRequest, NextResponse } from 'next/server';

/**
 * PCO OAuth callback — exchanges authorization code for access+refresh tokens
 * and redirects the user back to the settings page.
 *
 * The actual token storage is handled by the Cloud Function `pcoOAuthCallback`
 * which is called server-side. This route acts as a thin Next.js proxy that
 * forwards the code + state to the Cloud Function endpoint.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // orgId
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/settings?pco=error&reason=' + encodeURIComponent(error), request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?pco=error&reason=missing_params', request.url));
  }

  // Forward to Cloud Function to exchange tokens server-side (keeps client secret off the browser)
  const functionUrl = `https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthCallback`;

  try {
    const response = await fetch(`${functionUrl}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);

    if (!response.ok) {
      return NextResponse.redirect(new URL('/settings?pco=error&reason=token_exchange', request.url));
    }

    return NextResponse.redirect(new URL('/settings?pco=connected', request.url));
  } catch {
    return NextResponse.redirect(new URL('/settings?pco=error&reason=network', request.url));
  }
}
