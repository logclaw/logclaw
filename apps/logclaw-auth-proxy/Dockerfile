# Multi-stage build for LogClaw Auth Proxy

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package.json package-lock.json* yarn.lock* ./

# Install all dependencies (including devDeps for tsc)
RUN npm ci || npm install

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npx tsc

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built artifacts from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# Use existing non-root node user
USER node

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4318/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose ports
EXPOSE 4318 4317

# Use dumb-init to handle signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "start"]
