import { NextRequest, NextResponse } from 'next/server';
import { getConversation } from '@/lib/conversation-registry';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const conversation = getConversation(sessionId);
    if (!conversation) {
      return NextResponse.json({ interrupted: false });
    }

    await conversation.interrupt();

    return NextResponse.json({ interrupted: true });
  } catch (error) {
    console.error('[interrupt] Failed to interrupt:', error);
    return NextResponse.json({ interrupted: false, error: String(error) });
  }
}
