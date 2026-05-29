FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

# Install all deps (including devDependencies) via npm workspaces
RUN npm ci --include=dev

# Copy source
COPY packages/core/src packages/core/src
COPY packages/server/src packages/server/src

# Build core first (depended on by server), then server
RUN npm run build -w packages/core
RUN npm run build -w packages/server

# ── Production image (self-hosted) ─────────────────────────────────────
FROM node:22-alpine AS fuse-server
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S fuse -u 1001

# Install only production deps
COPY package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
RUN npm ci --omit=dev --workspaces --include-workspace-root

# Copy built artifacts
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/server/dist packages/server/dist

# Copy web UI
COPY packages/webui packages/webui

USER fuse
EXPOSE 3000 587
CMD ["node", "packages/server/dist/index.js"]

# ── SaaS image ────────────────────────────────────────────────────────
FROM node:22-alpine AS fuse-cloud
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S fuse -u 1001

COPY package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/cloud/package.json packages/cloud/
RUN npm ci --omit=dev --workspaces --include-workspace-root

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY packages/cloud/src packages/cloud/src

# Build cloud (it depends on core dist)
RUN npm run build -w packages/cloud

USER fuse
EXPOSE 3000 587
CMD ["node", "packages/cloud/dist/index.js"]
