import { NextRequest, NextResponse } from 'next/server';
import { isAuthEnabled, verifyToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    if (!isAuthEnabled()) {
      return NextResponse.json({ valid: true });
    }

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    if (verifyToken(token)) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Failed to verify token' }, { status: 500 });
  }
}
