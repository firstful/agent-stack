FROM node:22-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/nextjs/package.json apps/nextjs/
COPY apps/expo/package.json apps/expo/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build:packages

FROM node:22-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm@9

# Install netcat for database reachability checks in entrypoint.sh
RUN apk add --no-cache netcat-openbsd

COPY --from=builder /app /app

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV APP_PORT=3000
EXPOSE 3000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
