import { NextRequest, NextResponse } from 'next/server';
import { isAuthEnabled, isTokenFromEnv, verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const enabled = isAuthEnabled();
    let authenticated = false;

    if (enabled) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        authenticated = verifyToken(authHeader.slice(7));
      }
    } else {
      // Auth not enabled — everyone is "authenticated"
      authenticated = true;
    }

    return NextResponse.json({
      enabled,
      authenticated,
      tokenSource: enabled && isTokenFromEnv() ? 'env' : 'db',
    });
  } catch {
    return NextResponse.json({ error: 'Failed to check auth status' }, { status: 500 });
  }
}
