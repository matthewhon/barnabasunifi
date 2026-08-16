import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('orgId');

  if (!orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }

  const startUrl = `https://us-central1-barnabasunfi.cloudfunctions.net/pcoOAuthStart?orgId=${encodeURIComponent(orgId)}`;
  return NextResponse.redirect(startUrl);
}
