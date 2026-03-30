/**
 * Client-side fetch wrapper that automatically attaches the auth token
 * from localStorage and handles 401 responses.
 */

const AUTH_TOKEN_KEY = 'codepilot:auth_token';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Authenticated fetch — same API as window.fetch but auto-attaches
 * Authorization: Bearer header when a token is stored.
 * On 401 response, dispatches 'codepilot:auth-required' event to trigger re-auth.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('codepilot:auth-required'));
  }

  return response;
}
