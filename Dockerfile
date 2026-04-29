# syntax=docker/dockerfile:1.7
# ============================================================
# SafeClaw Web — Production Docker Image (multi-stage)
# ============================================================
# Build:  docker build -t safeclaw-web .
# Build with specific Claude Code version:
#         docker build --build-arg CLAUDE_CODE_VERSION=2.1.121 -t safeclaw-web .
# Run:    docker run -p 3811:3811 -v safeclaw-data:/data -v ~/projects:/workspaces safeclaw-web
# Custom port: docker run -p 8080:8080 -e PORT=8080 -v safeclaw-data:/data -v ~/projects:/workspaces safeclaw-web
#
# Build optimizations (BuildKit required, default in Docker 23+):
#   - npm cache + apt cache mounts persist tarballs between builds
#   - CLAUDE_CODE_VERSION pinned (was 'latest' which never cache-hit)
# ============================================================

# ---------- Stage 1: install dependencies ----------
FROM node:22-slim AS deps

WORKDIR /app

# Optional npm registry mirror — set to https://registry.npmmirror.com (China)
# or any internal proxy. Default is the official registry.
ARG NPM_REGISTRY=https://registry.npmjs.org

# Native build tools for better-sqlite3 / zlib-sync. apt cache mount keeps
# downloaded .debs across builds so re-pulls are skipped.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++

COPY package.json package-lock.json ./

# Web image doesn't need electron — its postinstall tries to download a
# Chromium binary from GitHub releases, which is slow/flaky in CI and
# wasted bytes for a server-only build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Cache mount for npm tarballs — persisted across builds so npm ci re-runs
# install from local cache instead of re-downloading from registry.
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "${NPM_REGISTRY}" && \
    npm ci --prefer-offline --no-audit --fund=false

COPY . .

# ---------- Stage 2: build Next.js standalone ----------
FROM node:22-slim AS builder

WORKDIR /app

COPY --from=deps /app ./

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------- Stage 3: minimal production runtime ----------
FROM node:22-slim AS runner

WORKDIR /app

# Runtime deps:
# - libsqlite3-0: better-sqlite3 native module
# - ca-certificates: outbound HTTPS
# - git: Claude Code CLI requirement
# - libreoffice-{impress,calc,writer}: headless office → PDF conversion
#   for PPTX/DOCX/XLSX preview (api/files/convert-pdf)
# - fonts-noto-cjk + fonts-noto-cjk-extra: CJK glyphs in the rendered PDF;
#   without these, Chinese / Japanese / Korean text becomes tofu boxes
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      libsqlite3-0 ca-certificates git \
      libreoffice-impress libreoffice-calc libreoffice-writer \
      fonts-noto-cjk fonts-noto-cjk-extra

# Install Claude Code CLI. Pin to a concrete version so this layer caches
# across builds — 'latest' would invalidate the cache on every build.
ARG CLAUDE_CODE_VERSION=2.1.121
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "${NPM_REGISTRY}" && \
    npm install -g --prefer-offline --no-audit --fund=false \
    @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Data directory — mount a volume here for persistence
ENV CLAUDE_GUI_DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /data /workspaces /home/nextjs/.claude && \
    chown -R nextjs:nodejs /data /workspaces /home/nextjs

# Copy standalone server output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy public assets
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

EXPOSE ${PORT:-3811}

ENV HOSTNAME=0.0.0.0
ENV PORT=3811

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3811)+'/api/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Fix ownership of mounted volumes at startup, then drop to nextjs
CMD chown nextjs:nodejs /data /workspaces 2>/dev/null; exec su -s /bin/sh nextjs -c "node server.js"
