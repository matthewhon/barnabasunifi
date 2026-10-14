import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const version = searchParams.get('version');

    // Locate the zip file in public/downloads
    const candidatePaths = [
      version
        ? path.join(process.cwd(), 'public', 'downloads', `unifi-pco-agent-v${version}.zip`)
        : null,
      path.join(process.cwd(), 'public', 'downloads', 'unifi-pco-agent.zip'),
      path.join(process.cwd(), 'app', 'public', 'downloads', 'unifi-pco-agent.zip'),
      path.resolve(__dirname, '../../../../../../public/downloads/unifi-pco-agent.zip'),
    ].filter(Boolean) as string[];

    let targetPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        targetPath = p;
        break;
      }
    }

    if (!targetPath) {
      return new NextResponse('Agent download package not found.', { status: 404 });
    }

    const fileBuffer = fs.readFileSync(targetPath);
    const filename = version ? `unifi-pco-agent-v${version}.zip` : 'unifi-pco-agent.zip';

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('[DownloadAgentAPI] Error serving agent zip:', error);
    return new NextResponse('Error downloading agent release.', { status: 500 });
  }
}
