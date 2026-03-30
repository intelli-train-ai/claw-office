import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  // No auth required here — the HTML page itself handles token input.
  // All API calls made from within the page carry the Bearer token.
  const html = readFileSync(join(process.cwd(), 'public', 'api-test.html'), 'utf-8');
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
