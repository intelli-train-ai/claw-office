import { NextRequest, NextResponse } from 'next/server';
import { deleteCustomCliTool, getCustomCliTool } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { id } = await params;

  const tool = getCustomCliTool(id);
  if (!tool) {
    return NextResponse.json({ error: 'Custom tool not found' }, { status: 404 });
  }

  deleteCustomCliTool(id);
  return NextResponse.json({ deleted: true });
}
