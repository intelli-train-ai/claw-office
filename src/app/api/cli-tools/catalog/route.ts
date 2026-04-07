import { NextRequest, NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG } from '@/lib/cli-tools-catalog';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  return NextResponse.json({ tools: CLI_TOOLS_CATALOG });
}
