import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectAllCliTools } from '@/lib/cli-tools-detect';
import { getExpandedPath } from '@/lib/platform';
import { getAllCliToolDescriptions, getAllCustomCliTools } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

async function detectBrew(): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/which', ['brew'], {
      timeout: 3000,
      env: { ...process.env, PATH: getExpandedPath() },
    });
    return true;
  } catch {
    return false;
  }
}

async function detectApt(): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/which', ['apt'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const [{ catalog, extra }, hasBrew, hasApt] = await Promise.all([
      detectAllCliTools(),
      detectBrew(),
      detectApt(),
    ]);
    const descriptions = getAllCliToolDescriptions();
    const allCustom = getAllCustomCliTools();
    // Filter out custom rows that shadow catalog tools (same binary path).
    // These rows exist only to store install metadata for update commands.
    const catalogBinPaths = new Set(catalog.filter(c => c.binPath).map(c => c.binPath!));
    const custom = allCustom.filter(ct => !catalogBinPaths.has(ct.binPath));
    return NextResponse.json({
      tools: catalog,
      extra,
      custom,
      descriptions,
      platform: process.platform,
      hasBrew,
      hasApt,
    });
  } catch (error) {
    console.error('[cli-tools/installed] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
