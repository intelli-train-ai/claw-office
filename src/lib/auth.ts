import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from './db';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Get the expected token hash. Environment variable takes priority over DB.
 * Returns null if no token is configured (auth disabled).
 */
export function getExpectedTokenHash(): string | null {
  const envToken = process.env.CODEPILOT_ACCESS_TOKEN;
  if (envToken) {
    return sha256(envToken);
  }
  const dbHash = getSetting('access_token_hash');
  return dbHash || null;
}

/** Whether token auth is enabled (a token is configured). */
export function isAuthEnabled(): boolean {
  return getExpectedTokenHash() !== null;
}

/** Whether the token source is an environment variable (read-only in UI). */
export function isTokenFromEnv(): boolean {
  return !!process.env.CODEPILOT_ACCESS_TOKEN;
}

/**
 * Verify a plaintext token against the expected hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyToken(plainToken: string): boolean {
  const expected = getExpectedTokenHash();
  if (!expected) return false;

  const inputHash = sha256(plainToken);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(inputHash, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Set the access token (stores SHA-256 hash in settings DB). */
export function setAccessToken(plainToken: string): void {
  setSetting('access_token_hash', sha256(plainToken));
}

/** Clear the access token from settings DB. */
export function clearAccessToken(): void {
  setSetting('access_token_hash', '');
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * Require authentication for an API route.
 * Returns a 401 NextResponse if auth fails, or null if OK.
 * If auth is not enabled, always returns null (pass-through).
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  if (!isAuthEnabled()) return null;

  const token = extractBearerToken(request);
  if (!token || !verifyToken(token)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }
  return null;
}
