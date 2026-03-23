import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { scanDirectory, isPathSafe, isRootPath } from '@/lib/files';
import type { FileTreeResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const dir = searchParams.get('dir');
  const depth = parseInt(searchParams.get('depth') || '3', 10);

  if (!dir) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing dir parameter' },
      { status: 400 }
    );
  }

  const resolvedDir = path.resolve(dir);
  const homeDir = os.homedir();

  // Use baseDir (the session's working directory) as the trust boundary.
  // baseDir is the project root the user explicitly chose — it may be on
  // a different drive than the home directory on Windows (e.g., D:\projects).
  // We only reject root paths (/, C:\) as baseDir to prevent full-disk scans.
  // If no baseDir is provided, fall back to the user's home directory.
  const baseDir = searchParams.get('baseDir');
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    // Prevent using a filesystem root as baseDir (e.g., /, C:\)
    if (isRootPath(resolvedBase)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Cannot use filesystem root as base directory' },
        { status: 403 }
      );
    }
    if (!isPathSafe(resolvedBase, resolvedDir)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Directory is outside the project scope' },
        { status: 403 }
      );
    }
  } else {
    // Fallback: without a baseDir, restrict to the user's home directory
    // to prevent scanning arbitrary system directories like /etc
    if (!isPathSafe(homeDir, resolvedDir)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Directory is outside the allowed scope' },
        { status: 403 }
      );
    }
  }

  try {
    const tree = await scanDirectory(resolvedDir, Math.min(depth, 5));
    return NextResponse.json<FileTreeResponse>({ tree, root: resolvedDir });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to scan directory' },
      { status: 500 }
    );
  }
}

/**
 * Delete a file or directory.
 * Requires `filePath` and `baseDir` — the file must be inside baseDir.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { filePath, baseDir } = await request.json();

    if (!filePath || !baseDir) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing filePath or baseDir' },
        { status: 400 }
      );
    }

    const resolvedPath = path.resolve(filePath);
    const resolvedBase = path.resolve(baseDir);

    if (isRootPath(resolvedBase)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Cannot use filesystem root as base directory' },
        { status: 403 }
      );
    }

    // Prevent deleting the project root itself
    if (resolvedPath === resolvedBase) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Cannot delete the project root' },
        { status: 403 }
      );
    }

    // Must be inside baseDir
    if (!isPathSafe(resolvedBase, resolvedPath)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path is outside the project scope' },
        { status: 403 }
      );
    }

    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true, force: true });
    } else {
      await fs.unlink(resolvedPath);
    }

    return NextResponse.json({ deleted: resolvedPath });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'File not found' },
        { status: 404 }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: 'Failed to delete' },
      { status: 500 }
    );
  }
}
