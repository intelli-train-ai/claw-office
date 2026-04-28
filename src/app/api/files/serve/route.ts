import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPathSafe(base: string, target: string): boolean {
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(normalizedBase);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf',
  '.xml': 'text/xml', '.txt': 'text/plain', '.csv': 'text/csv',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const RECORDER_SCRIPT = `
<script data-safeclaw-recorder>
(function(){
  if(window.__cpRecorderInit) return;
  window.__cpRecorderInit = true;
  var startTime = Date.now();
  function ts(){ return Date.now() - startTime; }
  function sel(el){
    if(!el || el === document) return 'document';
    if(el.id) return '#'+el.id;
    var tag = el.tagName?.toLowerCase()||'?';
    if(el.className && typeof el.className === 'string'){
      var cls = el.className.trim().split(/\\s+/).slice(0,2).join('.');
      if(cls) return tag+'.'+cls;
    }
    return tag;
  }
  function txt(el){
    var t = (el.innerText||el.textContent||'').trim();
    return t.length > 30 ? t.slice(0,30)+'…' : t;
  }
  document.addEventListener('click', function(e){
    parent.postMessage({type:'recorder-event', event:{
      type:'click', ts:ts(), target:sel(e.target), text:txt(e.target), x:e.clientX, y:e.clientY
    }},'*');
  }, true);
  document.addEventListener('input', function(e){
    var val = (e.target.value||'').slice(0,200);
    parent.postMessage({type:'recorder-event', event:{
      type:'input', ts:ts(), target:sel(e.target), value:val
    }},'*');
  }, true);
  var scrollTimer;
  window.addEventListener('scroll', function(){
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function(){
      parent.postMessage({type:'recorder-event', event:{
        type:'scroll', ts:ts(), scrollX:window.scrollX, scrollY:window.scrollY
      }},'*');
    }, 300);
  }, true);
  window.addEventListener('hashchange', function(){
    parent.postMessage({type:'recorder-event', event:{
      type:'navigate', ts:ts(), url:location.href
    }},'*');
  });
  window.addEventListener('popstate', function(){
    parent.postMessage({type:'recorder-event', event:{
      type:'navigate', ts:ts(), url:location.href
    }},'*');
  });
})();
</script>
`;

/**
 * Serve files from a project directory with proper MIME types.
 * For HTML files, injects the interaction recorder script.
 *
 * Query params:
 *   root  - the project root directory (security boundary)
 *   path  - relative file path within root
 *   record - if "1", inject recorder script into HTML (default: no injection)
 */
export async function GET(request: NextRequest) {
  // Support token via query param (for iframe src which can't set headers)
  const queryToken = request.nextUrl.searchParams.get('token');
  if (queryToken) {
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${queryToken}`);
    const authedReq = new NextRequest(request.url, { headers });
    const authError = requireAuth(authedReq);
    if (authError) return authError;
  } else {
    const authError = requireAuth(request);
    if (authError) return authError;
  }

  const root = request.nextUrl.searchParams.get('root');
  const filePath = request.nextUrl.searchParams.get('path');
  const record = request.nextUrl.searchParams.get('record') === '1';

  if (!root || !filePath) {
    return new Response(JSON.stringify({ error: 'root and path parameters are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, filePath);

  // Security: file must be within root (no homedir restriction on root itself — Docker mounts may be outside homedir)
  if (!isPathSafe(resolvedRoot, resolved)) {
    return new Response(JSON.stringify({ error: 'Path is outside the allowed scope' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await fs.access(resolved);
  } catch {
    return new Response(JSON.stringify({ error: 'File not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    return new Response(JSON.stringify({ error: 'Not a file' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // For HTML files: inject <base> for relative paths, optionally inject recorder
  if (ext === '.html' || ext === '.htm') {
    let html = await fs.readFile(resolved, 'utf-8');

    // Rewrite relative resource paths to go through this serve endpoint
    // so that CSS/JS/images referenced by the HTML also resolve correctly
    const tokenParam = queryToken ? `&token=${encodeURIComponent(queryToken)}` : '';
    const baseParam = `root=${encodeURIComponent(resolvedRoot)}${tokenParam}`;
    const dirRelative = path.dirname(filePath);

    // Inject <base> tag so relative URLs resolve against this endpoint
    const baseHref = `/api/files/serve?${baseParam}&path=${encodeURIComponent(dirRelative)}/`;
    const baseTag = `<base href="${baseHref}">`;

    // Insert base tag after <head> or at the start
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${baseTag}`);
    } else if (html.includes('<html')) {
      html = html.replace(/<html[^>]*>/, `$&<head>${baseTag}</head>`);
    } else {
      html = baseTag + html;
    }

    // Inject recorder script only when recording is enabled
    if (record) {
      if (html.includes('</body>')) {
        html = html.replace('</body>', `${RECORDER_SCRIPT}</body>`);
      } else {
        html += RECORDER_SCRIPT;
      }
    }

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // For large files, stream the response instead of buffering into memory.
  const MAX_BUFFERED_SIZE = 10 * 1024 * 1024;
  if (stat.size > MAX_BUFFERED_SIZE) {
    const nodeStream = createReadStream(resolved);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'private, max-age=60',
      },
    });
  }

  const buffer = await fs.readFile(resolved);

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
