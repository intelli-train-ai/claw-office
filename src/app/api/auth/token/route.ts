import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, setAccessToken, clearAccessToken, isTokenFromEnv } from '@/lib/auth';

/** Set a new access token. */
export async function PUT(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    if (isTokenFromEnv()) {
      return NextResponse.json(
        { error: 'Token is managed via environment variable and cannot be changed from the UI' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== 'string' || token.length < 6) {
      return NextResponse.json(
        { error: 'Token must be at least 6 characters' },
        { status: 400 },
      );
    }

    setAccessToken(token);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to set token' }, { status: 500 });
  }
}

/** Clear the access token (disable auth). */
export async function DELETE(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    if (isTokenFromEnv()) {
      return NextResponse.json(
        { error: 'Token is managed via environment variable and cannot be cleared from the UI' },
        { status: 403 },
      );
    }

    clearAccessToken();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to clear token' }, { status: 500 });
  }
}
