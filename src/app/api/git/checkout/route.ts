import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  try {
    const { cwd, branch } = await req.json();
    if (!cwd || !branch) {
      return NextResponse.json({ error: 'cwd and branch are required' }, { status: 400 });
    }

    await gitService.checkout(cwd, branch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
