# ============================================================
# CodePilot Web — Production Docker Image (multi-stage)
# ============================================================
# Build:  docker build -t codepilot-web .
# Build with specific Claude Code version:
#         docker build --build-arg CLAUDE_CODE_VERSION=1.0.0 -t codepilot-web .
# Run:    docker run -p 3811:3811 -v codepilot-data:/data -v ~/projects:/workspace codepilot-web
# Custom port: docker run -p 8080:8080 -e PORT=8080 -v codepilot-data:/data -v ~/projects:/workspace codepilot-web
# ============================================================

# ---------- Stage 1: clone + install dependencies ----------
FROM node:22-slim AS deps

WORKDIR /app

# Git for cloning, native build tools for better-sqlite3 / zlib-sync
RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ARG CODEPILOT_BRANCH=main
RUN git clone --depth 1 --branch ${CODEPILOT_BRANCH} \
    https://github.com/intelli-train-ai/CodePilot.git /app

RUN npm ci

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

# Runtime deps: better-sqlite3, SSL certs, git (required by Claude Code CLI)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates git && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (version controlled via build arg)
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Data directory — mount a volume here for persistence
ENV CLAUDE_GUI_DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /data /workspace /home/nextjs/.claude && \
    chown -R nextjs:nodejs /data /workspace /home/nextjs

# Copy standalone server output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Copy static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy public assets
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE ${PORT:-3811}

ENV HOSTNAME=0.0.0.0
ENV PORT=3811

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3811)+'/api/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
