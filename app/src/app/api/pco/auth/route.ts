import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('orgId');

  if (!orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_PCO_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/pco/callback`;

  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'services groups',
    state: orgId,
  });

  const authUrl = `https://api.planningcenteronline.com/oauth/authorize?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
