import { NextRequest } from 'next/server';
import { listClaudeSessions } from '@/lib/claude-session-parser';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const sessions = listClaudeSessions();
    return Response.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/claude-sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
