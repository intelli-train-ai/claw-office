import { NextRequest, NextResponse } from 'next/server';
import { invalidateClaudeClientCache } from '@/lib/claude-client';
import { invalidateWingetCache } from '@/lib/platform';
import { requireAuth } from '@/lib/auth';

/**
 * POST /api/claude-status/invalidate
 * Clears all cached Claude binary paths and install-type detection so the next
 * status check picks up freshly-installed binaries. Called by the install
 * wizard and upgrade flow on success.
 */
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  invalidateClaudeClientCache();
  invalidateWingetCache();
  return NextResponse.json({ ok: true });
}
