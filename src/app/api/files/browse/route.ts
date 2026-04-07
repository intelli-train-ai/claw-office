import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ErrorResponse } from '@/types';
import { requireAuth } from '@/lib/auth';

async function getWindowsDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ':\\';
    try {
      await fs.access(drive);
      drives.push(drive);
    } catch {
      // drive not available
    }
  }
  return drives;
}

// Create a new directory inside the given parent
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const { dir, name } = await request.json();
    if (!dir || !name) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing dir or name' },
        { status: 400 }
      );
    }

    // Prevent path traversal
    if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid folder name' },
        { status: 400 }
      );
    }

    const newDir = path.join(path.resolve(dir), name);

    try {
      await fs.access(newDir);
      return NextResponse.json<ErrorResponse>(
        { error: 'Folder already exists' },
        { status: 409 }
      );
    } catch {
      // Does not exist — good, proceed to create
    }

    await fs.mkdir(newDir, { recursive: true });

    return NextResponse.json({ path: newDir });
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Failed to create folder' },
      { status: 500 }
    );
  }
}

// List only directories for folder browsing (no safety restriction since user is choosing where to work)
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const dir = searchParams.get('dir') || os.homedir();

  const resolvedDir = path.resolve(dir);

  try {
    await fs.access(resolvedDir);
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Directory does not exist' },
      { status: 404 }
    );
  }

  try {
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    const directories = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: path.join(resolvedDir, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const drives = await getWindowsDrives();

    return NextResponse.json({
      current: resolvedDir,
      parent: path.dirname(resolvedDir) !== resolvedDir ? path.dirname(resolvedDir) : null,
      directories,
      drives,
    });
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot read directory' },
      { status: 500 }
    );
  }
}
