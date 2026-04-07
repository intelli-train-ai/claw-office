import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { scanDirectory, isPathSafe, isRootPath } from '@/lib/files';
import type { FileTreeResponse, ErrorResponse } from '@/types';
import { requireAuth } from '@/lib/auth';

/** Writable text-based extensions (markdown, plain text, config, code, etc.) */
const WRITABLE_TEXT_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.text', '.markdown',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.css', '.scss', '.less', '.html', '.htm', '.xml', '.svg',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log', '.sql',
]);

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

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
 * Write / update a text file.
 * Requires `filePath`, `baseDir`, and `content`.
 * Only allows writing to known text-based file extensions to prevent
 * accidental binary corruption.
 */
export async function PUT(request: NextRequest) {
  try {
    const { filePath, baseDir, content } = await request.json();

    if (!filePath || !baseDir || typeof content !== 'string') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing filePath, baseDir, or content' },
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

    if (!isPathSafe(resolvedBase, resolvedPath)) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path is outside the project scope' },
        { status: 403 }
      );
    }

    // Only allow writing to text-based files
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!WRITABLE_TEXT_EXTENSIONS.has(ext)) {
      return NextResponse.json<ErrorResponse>(
        { error: `File type "${ext}" is not supported for editing` },
        { status: 400 }
      );
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf-8');

    return NextResponse.json({ saved: resolvedPath });
  } catch (e) {
    return NextResponse.json<ErrorResponse>(
      { error: e instanceof Error ? e.message : 'Failed to save file' },
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
