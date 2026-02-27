# ============================================================
#  SatuBooster Telephony Server — Production Dockerfile
# ============================================================
#  Multi-stage build for a minimal, secure Node.js image.
#
#  Build:  docker build -t satubooster-telephony .
#  Run:    docker run -d --env-file .env -p 3000:3000 satubooster-telephony
# ============================================================

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Stage 2: Production image ─────────────────────────────────
FROM node:18-alpine AS runner

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source code
COPY package.json ./
COPY src ./src
COPY ecosystem.config.js ./

# Create logs directory
RUN mkdir -p logs && chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the API port
EXPOSE 3000

# Health check — PM2/Docker can use this to verify the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "src/index.js"]
