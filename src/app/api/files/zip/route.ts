import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { requireAuth } from '@/lib/auth';
import { isPathSafe, isRootPath } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  '.cache',
  '.output',
  'coverage',
  '__pycache__',
  '__MACOSX',
  '.DS_Store',
  'release',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;

interface AddDirOptions {
  zip: AdmZip;
  rootDir: string;
  totalSize: { value: number };
}

async function addDirToZip(currentDir: string, opts: AddDirOptions): Promise<void> {
  const { zip, rootDir, totalSize } = opts;
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('._')) continue;

    const fullPath = path.join(currentDir, entry.name);

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      await addDirToZip(fullPath, opts);
    } else if (entry.isFile()) {
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SIZE) continue;
      totalSize.value += stat.size;
      if (totalSize.value > MAX_TOTAL_SIZE) {
        throw new Error('PROJECT_TOO_LARGE');
      }
      const data = await fs.readFile(fullPath);
      const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
      zip.addFile(relPath, data);
    }
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const targetPath = request.nextUrl.searchParams.get('path');
  const baseDir = request.nextUrl.searchParams.get('baseDir');

  if (!targetPath) {
    return jsonError('path parameter is required', 400);
  }

  const resolved = path.resolve(targetPath);

  if (isRootPath(resolved)) {
    return jsonError('Cannot zip filesystem root', 403);
  }

  const homeDir = os.homedir();
  const workspaceDir = process.env.SAFECLAW_WORKSPACE;
  const allowedBases = [
    baseDir ? path.resolve(baseDir) : null,
    workspaceDir ? path.resolve(workspaceDir) : null,
    homeDir,
  ].filter((b): b is string => !!b);

  if (!allowedBases.some((b) => isPathSafe(b, resolved))) {
    return jsonError('Path is outside the allowed scope', 403);
  }

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return jsonError('Path not found', 404);
  }
  if (!stat.isDirectory()) {
    return jsonError('Path is not a directory', 400);
  }

  const zip = new AdmZip();
  const totalSize = { value: 0 };

  try {
    await addDirToZip(resolved, { zip, rootDir: resolved, totalSize });
  } catch (e) {
    if (e instanceof Error && e.message === 'PROJECT_TOO_LARGE') {
      return jsonError(`Project exceeds ${MAX_TOTAL_SIZE / 1024 / 1024} MB limit`, 413);
    }
    console.error('Zip build error:', e);
    return jsonError('Failed to build zip', 500);
  }

  const buffer = zip.toBuffer();
  const baseName = path.basename(resolved) || 'project';
  const safeName = baseName.replace(/[^\w.\-]+/g, '_');
  const encodedName = encodeURIComponent(`${baseName}.zip`);

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${safeName}.zip"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'no-store',
    },
  });
}
