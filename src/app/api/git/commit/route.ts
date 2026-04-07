import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { cwd, message } = await req.json();
    if (!cwd) {
      return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }

    const sha = await gitService.commit(cwd, message || '');
    return NextResponse.json({ success: true, sha });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Commit failed' },
      { status: 500 }
    );
  }
}
