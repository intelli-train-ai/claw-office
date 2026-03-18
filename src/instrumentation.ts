/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * NOTE: undici ProxyAgent is incompatible with some proxy software (Clash, V2Ray),
 * causing fetch() to silently fail. Instead, proxy support is handled per-adapter
 * using https-proxy-agent where needed (e.g., Telegram long-polling).
 *
 * The HTTP_PROXY / HTTPS_PROXY env vars are still respected by external tools
 * (curl, git, etc.) and by adapters that explicitly use https-proxy-agent.
 */
export async function register() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy;

  if (proxyUrl) {
    console.log(`[instrumentation] Proxy detected: ${proxyUrl} (per-adapter injection, not global undici)`);
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initRuntimeLog } = await import('@/lib/runtime-log');
    initRuntimeLog();
  }
}
