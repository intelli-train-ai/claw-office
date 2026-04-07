/**
 * WeChat global settings API.
 * GET — returns current settings
 * PUT — updates settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const WEIXIN_KEYS = [
  'bridge_weixin_enabled',
  'bridge_weixin_media_enabled',
] as const;

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const settings: Record<string, string> = {};
    for (const key of WEIXIN_KEYS) {
      settings[key] = getSetting(key) || '';
    }
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { settings } = body as { settings?: Record<string, string> };
    if (!settings) {
      return NextResponse.json({ error: 'Missing settings' }, { status: 400 });
    }

    for (const key of WEIXIN_KEYS) {
      if (key in settings) {
        setSetting(key, settings[key]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
