import { NextRequest, NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG } from '@/lib/cli-tools-catalog';
import { detectCliTool } from '@/lib/cli-tools-detect';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const tool = CLI_TOOLS_CATALOG.find(t => t.id === id);
  if (!tool) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  try {
    const info = await detectCliTool(tool);
    return NextResponse.json(info);
  } catch (error) {
    console.error(`[cli-tools/${id}/status] Error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
