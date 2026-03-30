/**
 * Start WeChat QR code login.
 * POST — generates a QR code for scanning
 */

import { NextRequest, NextResponse } from 'next/server';
import { startQrLoginSession } from '@/lib/bridge/adapters/weixin/weixin-auth';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { sessionId, qrImage } = await startQrLoginSession();
    return NextResponse.json({ session_id: sessionId, qr_image: qrImage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start QR login' },
      { status: 500 },
    );
  }
}
