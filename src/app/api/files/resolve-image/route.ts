import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resolve a relative image path by searching upward from the markdown file's
 * directory toward the working directory (project root).
 *
 * Query params:
 *   - src:     the relative image path as written in markdown (e.g. "assets/pic.png")
 *   - mdFile:  absolute path of the markdown file
 *   - workDir: absolute path of the working directory (project root)
 *
 * Returns 302 redirect to /api/files/raw?path=<resolved> on success, or 404.
 */
export async function GET(request: NextRequest) {
  const authError = requireAuth(request);
  if (authError) return authError;

  const src = request.nextUrl.searchParams.get('src');
  const mdFile = request.nextUrl.searchParams.get('mdFile');
  const workDir = request.nextUrl.searchParams.get('workDir');

  if (!src || !mdFile) {
    return new Response(JSON.stringify({ error: 'src and mdFile are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Don't resolve absolute URLs or protocol-prefixed paths
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('blob:')) {
    return new Response(JSON.stringify({ error: 'Not a relative path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mdDir = path.dirname(path.resolve(mdFile));
  const root = workDir ? path.resolve(workDir) : mdDir;

  // Walk upward from mdDir to root, trying to resolve the image at each level
  let current = mdDir;
  while (true) {
    const candidate = path.resolve(current, src);

    // Security: don't escape above root
    if (!candidate.startsWith(root)) break;

    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        // Redirect to the raw file endpoint
        const rawUrl = `/api/files/raw?path=${encodeURIComponent(candidate)}`;
        return new Response(null, {
          status: 302,
          headers: { Location: rawUrl },
        });
      }
    } catch {
      // File not found at this level, continue searching
    }

    // Move up one directory
    const parent = path.dirname(current);
    if (parent === current) break; // reached filesystem root
    current = parent;
  }

  return new Response(JSON.stringify({ error: 'Image not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}
