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

  try {
    const branches = await gitService.getBranches(cwd);
    return NextResponse.json({ branches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get branches' },
      { status: 500 }
    );
  }
}
