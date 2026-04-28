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
    // Initialize Sentry for server-side error capture (respects opt-out marker file)
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (dsn) {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const markerPath = path.join(os.homedir(), '.safeclaw', 'sentry-disabled');
      const optedOut = fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf-8').trim() === 'true';
      if (!optedOut) {
        const Sentry = await import('@sentry/node');
        Sentry.init({
          dsn,
          environment: process.env.NODE_ENV,
          release: `safeclaw@${process.env.NEXT_PUBLIC_APP_VERSION}`,
          tracesSampleRate: 0,
          ignoreErrors: [
            'AbortError',
            'Operation aborted',
            'The operation was aborted',
            'signal is aborted',
          ],
          beforeSend(event) {
            // Strip auth headers
            if (event.request?.headers) {
              delete event.request.headers['x-api-key'];
              delete event.request.headers['authorization'];
              delete event.request.headers['anthropic-api-key'];
            }
            // Add server context
            event.tags = {
              ...event.tags,
              runtime: 'server',
              'os.platform': process.platform,
              'os.arch': process.arch,
              'node.version': process.version,
            };
            return event;
          },
        });
      }
    }

    const { initRuntimeLog } = await import('@/lib/runtime-log');
    initRuntimeLog();

    // Start the task scheduler so persisted tasks resume on cold boot
    // (previously only started as a side effect of /api/chat)
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();
  }
}
