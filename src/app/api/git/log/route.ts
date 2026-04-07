import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);

  try {
    const entries = await gitService.getLog(cwd, limit);
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get log' },
      { status: 500 }
    );
  }
}
