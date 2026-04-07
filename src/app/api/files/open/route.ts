import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { requireAuth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const { path: targetPath } = await req.json();
  if (!targetPath || typeof targetPath !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const platform = process.platform;
  let bin: string;
  if (platform === 'darwin') {
    bin = 'open';
  } else if (platform === 'win32') {
    bin = 'explorer';
  } else {
    bin = 'xdg-open';
  }

  return new Promise<NextResponse>((resolve) => {
    execFile(bin, [targetPath], (err) => {
      if (err) {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      } else {
        resolve(NextResponse.json({ ok: true }));
      }
    });
  });
}
