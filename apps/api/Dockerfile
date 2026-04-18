# syntax=docker/dockerfile:1.7
# ===========================================================================
# Multi-stage build for @agc/api.
# Stage 1: install all deps (dev+prod) and compile TS.
# Stage 2: install ONLY prod deps.
# Stage 3: minimal runtime image.
# ===========================================================================

# ---------- Stage 1: build ----------
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo

# Copy workspace files first (small, good cache hit rate).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# Install all deps (incl. dev for tsc/nest cli).
RUN pnpm install --frozen-lockfile

# Copy source and build.
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
RUN pnpm --filter @agc/api build

# ---------- Stage 2: prod deps only ----------
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@9.15.9 --activate

WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @agc/api...

# ---------- Stage 3: runtime ----------
#
# Debian (bookworm-slim) instead of Alpine so we can pull pg_dump v18+
# from PGDG's apt repo. Railway's managed Postgres upgraded to 18.3;
# pg_dump refuses to dump a newer server ("aborting because of server
# version mismatch"), so we need a client whose major version ≥ the
# server. Alpine's repos still ship pg16/17-client, which is why the
# backup cron was erroring.
#
# Cost: ~60 MB bigger image than Alpine. Worth it for deterministic
# backup success.
FROM node:20-bookworm-slim AS runtime

# tini for pid1 zombie reaping. postgresql-client-18 for pg_dump.
# Keys + sources.list dance follows the official PGDG apt instructions.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg tini && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-18 && \
    apt-get purge -y --auto-remove curl gnupg && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system agc && useradd --system --gid agc agc
USER agc
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Mirror the repo layout so Node's module resolution finds every dep.
# pnpm workspaces store api-specific modules in apps/api/node_modules with
# symlinks back to the root .pnpm store; if dist/main.js doesn't live
# INSIDE apps/api, Node walks up from /app/dist → /app and never sees the
# api's own node_modules. Keeping the workspace shape avoids that.
COPY --from=prod-deps   --chown=agc:agc /repo/node_modules                  ./node_modules
COPY --from=prod-deps   --chown=agc:agc /repo/packages                      ./packages
COPY --from=prod-deps   --chown=agc:agc /repo/apps/api/node_modules         ./apps/api/node_modules
COPY --from=prod-deps   --chown=agc:agc /repo/apps/api/package.json         ./apps/api/package.json
COPY --from=build       --chown=agc:agc /repo/apps/api/dist                 ./apps/api/dist

# Uploads dir must be writable by the non-root user. Persistence is the
# host's responsibility — declare a volume mount in your platform:
#   * Docker Compose: `volumes: ["uploads:/app/uploads"]`
#   * Railway:         add a Volume on the service, mount path `/app/uploads`
#   * Render:          set a Disk mount at `/app/uploads` (see render.yaml)
# The VOLUME directive is intentionally NOT declared here — Railway rejects
# it and Compose/Render both configure persistence externally anyway.
RUN mkdir -p /app/uploads

WORKDIR /app/apps/api
EXPOSE 4000
# Debian places tini at /usr/bin/tini, not /sbin/tini (Alpine).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
