import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);

const CONVERTIBLE_EXTENSIONS = new Set(['.pptx', '.ppt', '.docx', '.doc']);

function isPathSafe(base: string, target: string): boolean {
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(normalizedBase);
}

/**
 * Convert office files to PDF using LibreOffice and return the PDF binary.
 * Used for high-fidelity preview of PPTX and other office formats.
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const filePath = request.nextUrl.searchParams.get('path');
  const baseDir = request.nextUrl.searchParams.get('baseDir');
  if (!filePath) {
    return Response.json({ error: 'path parameter is required' }, { status: 400 });
  }

  const resolved = path.resolve(filePath);
  const homeDir = os.homedir();
  const workspaceDir = process.env.SAFECLAW_WORKSPACE;

  // Trust the session's working directory first; fall back to SAFECLAW_WORKSPACE
  // (Docker mount root) and finally to the user's home directory.
  const allowedBases = [
    baseDir ? path.resolve(baseDir) : null,
    workspaceDir ? path.resolve(workspaceDir) : null,
    homeDir,
  ].filter((b): b is string => !!b);

  if (!allowedBases.some((b) => isPathSafe(b, resolved))) {
    return Response.json({ error: 'File is outside the allowed scope' }, { status: 403 });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!CONVERTIBLE_EXTENSIONS.has(ext)) {
    return Response.json({ error: `Unsupported file type: ${ext}` }, { status: 400 });
  }

  try {
    await fs.access(resolved);
  } catch {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safeclaw-pdf-'));
  try {
    await execFileAsync('libreoffice', [
      '--headless', '--convert-to', 'pdf', '--outdir', tmpDir, resolved,
    ], { timeout: 30000 });

    const baseName = path.basename(resolved, ext) + '.pdf';
    const pdfPath = path.join(tmpDir, baseName);
    const pdfBuffer = await fs.readFile(pdfPath);

    const encodedName = encodeURIComponent(baseName);
    return new Response(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const message = e?.message || 'PDF conversion failed';
    // ENOENT here means the `libreoffice` binary itself wasn't found on PATH —
    // give a more actionable error than a generic 500 so deploy environments
    // missing LibreOffice can be diagnosed quickly.
    if (e?.code === 'ENOENT' || /\blibreoffice\b.*not found/i.test(message) ||
        /spawn libreoffice ENOENT/i.test(message)) {
      return Response.json(
        { error: 'LibreOffice is not installed in this environment. Rebuild the image with libreoffice + fonts-noto-cjk.' },
        { status: 501 },
      );
    }
    return Response.json({ error: message }, { status: 500 });
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
