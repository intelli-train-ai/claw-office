import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { requireAuth } from '@/lib/auth';
import type { ErrorResponse } from '@/types';

export const runtime = 'nodejs';

const MAX_ZIP_SIZE = 500 * 1024 * 1024;

function sanitizeFolderName(input: string): string {
  const base = input.replace(/\.zip$/i, '');
  return base
    .replace(/[/\\]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .trim();
}

/**
 * Import a ZIP archive into a new sub-folder of `dir`.
 * The folder name is derived from the ZIP file name (without the .zip suffix).
 */
export async function POST(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const targetDir = formData.get('dir') as string | null;
    const file = formData.get('file') as File | null;

    if (!targetDir || !file) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing dir or file' },
        { status: 400 }
      );
    }

    if (file.size > MAX_ZIP_SIZE) {
      return NextResponse.json<ErrorResponse>(
        { error: `ZIP exceeds ${MAX_ZIP_SIZE / 1024 / 1024} MB limit` },
        { status: 413 }
      );
    }

    const resolvedDir = path.resolve(targetDir);
    try {
      const stat = await fs.stat(resolvedDir);
      if (!stat.isDirectory()) {
        return NextResponse.json<ErrorResponse>(
          { error: 'Target path is not a directory' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json<ErrorResponse>(
        { error: 'Target directory does not exist' },
        { status: 404 }
      );
    }

    const folderName = sanitizeFolderName(file.name);
    if (!folderName) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid ZIP file name' },
        { status: 400 }
      );
    }

    const destDir = path.join(resolvedDir, folderName);
    try {
      await fs.access(destDir);
      return NextResponse.json(
        { error: 'Folder already exists', folderName },
        { status: 409 }
      );
    } catch {
      // Does not exist — proceed
    }

    let zip: AdmZip;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      zip = new AdmZip(buffer);
    } catch {
      return NextResponse.json<ErrorResponse>(
        { error: 'Invalid or corrupt ZIP file' },
        { status: 400 }
      );
    }

    const entries = zip.getEntries();
    const junkPrefixes = ['__MACOSX/', '._'];

    for (const entry of entries) {
      if (junkPrefixes.some((p) => entry.entryName.startsWith(p) || entry.entryName.includes('/' + p))) {
        continue;
      }
      const entryTarget = path.resolve(destDir, entry.entryName);
      if (!entryTarget.startsWith(destDir + path.sep) && entryTarget !== destDir) {
        return NextResponse.json<ErrorResponse>(
          { error: `Blocked path traversal in zip entry: ${entry.entryName}` },
          { status: 400 }
        );
      }
    }

    await fs.mkdir(destDir, { recursive: true });

    try {
      for (const entry of entries) {
        if (junkPrefixes.some((p) => entry.entryName.startsWith(p) || entry.entryName.includes('/' + p))) {
          continue;
        }
        const entryTarget = path.resolve(destDir, entry.entryName);
        if (entry.isDirectory) {
          await fs.mkdir(entryTarget, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(entryTarget), { recursive: true });
          await fs.writeFile(entryTarget, entry.getData());
        }
      }
    } catch (e) {
      console.error('ZIP extraction error:', e);
      await fs.rm(destDir, { recursive: true, force: true }).catch(() => {});
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to extract ZIP' },
        { status: 500 }
      );
    }

    return NextResponse.json({ path: destDir, folderName });
  } catch (e) {
    console.error('ZIP import error:', e);
    return NextResponse.json<ErrorResponse>(
      { error: 'Failed to import ZIP' },
      { status: 500 }
    );
  }
}
