import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ErrorResponse } from '@/types';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.gz', '.tgz', '.tar.gz', '.bz2', '.tar.bz2']);

function isArchive(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(path.extname(lower))) return true;
  // Handle double extensions like .tar.gz
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tar.bz2')) return true;
  return false;
}

async function extractTar(archivePath: string, destDir: string): Promise<void> {
  await execFileAsync('tar', ['xf', archivePath, '-C', destDir]);
}

/**
 * Upload files to the working directory.
 * Archives (.zip, .tar.gz, etc.) are automatically extracted.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const targetDir = formData.get('dir') as string;

    if (!targetDir) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing target directory' },
        { status: 400 }
      );
    }

    const resolvedDir = path.resolve(targetDir);

    try {
      await fs.access(resolvedDir);
    } catch {
      return NextResponse.json<ErrorResponse>(
        { error: 'Target directory does not exist' },
        { status: 404 }
      );
    }

    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return NextResponse.json<ErrorResponse>(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    const results: { name: string; path: string; extracted?: boolean }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = file.name;
      const filePath = path.join(resolvedDir, fileName);

      if (isArchive(fileName)) {
        // Extract archive
        const ext = fileName.toLowerCase();

        if (ext.endsWith('.zip')) {
          const zip = new AdmZip(buffer);
          // Filter out macOS resource fork junk before extracting
          const junkPrefixes = ['__MACOSX/', '._'];
          const entries = zip.getEntries();
          for (const entry of entries) {
            if (junkPrefixes.some(p => entry.entryName.startsWith(p))) {
              zip.deleteFile(entry);
            }
          }
          zip.extractAllTo(resolvedDir, true);
          results.push({ name: fileName, path: resolvedDir, extracted: true });
        } else {
          // For tar-based archives, write temp file then extract
          const tempPath = path.join(resolvedDir, `.__upload_temp_${Date.now()}_${fileName}`);
          try {
            await fs.writeFile(tempPath, buffer);
            await extractTar(tempPath, resolvedDir);
            results.push({ name: fileName, path: resolvedDir, extracted: true });
          } finally {
            await fs.unlink(tempPath).catch(() => {});
          }
        }
      } else {
        // Regular file — just write it
        await fs.writeFile(filePath, buffer);
        results.push({ name: fileName, path: filePath });
      }
    }

    return NextResponse.json({ files: results });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json<ErrorResponse>(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
