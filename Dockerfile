# Blackbook, the Vara5 Client 360 platform.
#
# Three stages so the published image carries only the compiled server and its
# runtime dependencies: no pnpm store, no source, no dev packages.

# ---------------------------------------------------------------- dependencies
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------- build
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Deliberately fake, and never used.
#
# `next build` loads every route module to collect its configuration, and Better
# Auth's Drizzle adapter reads the client as it initialises. Nothing queries at
# build time, so this value is only ever constructed and discarded. It points at
# a host that does not exist on purpose: if a future change did try to reach the
# database during a build, it would fail loudly here rather than quietly
# connecting to something real. The running container is given the true value.
# Passed to the build command only, so neither value is baked into any layer.
RUN DATABASE_URL="postgresql://build:build@build.invalid:5432/build"     BETTER_AUTH_SECRET="build-time-placeholder-never-used-for-signing"     pnpm build

# pnpm links packages into a content-addressed store, and Next's standalone
# output nests what it traced, so neither is importable as a bare specifier
# from a standalone script. Dereference the two the migrator needs. Both are
# dependency-free, so this is the whole of it.
RUN mkdir -p /migrator/node_modules  && cp -rL node_modules/drizzle-orm /migrator/node_modules/drizzle-orm  && cp -rL node_modules/postgres /migrator/node_modules/postgres

# --------------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Runs unprivileged. node:alpine already ships a `node` user.
RUN mkdir .next && chown node:node .next

# `output: "standalone"` produces a server plus exactly the modules it needs.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# Migrations are applied from a one-off container against this same image, so
# the SQL and the migrator travel with it. Only these two files are needed:
# the migrator is part of drizzle-orm, which the standalone output already
# carries, so drizzle-kit and its build tooling stay out of the image.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=node:node /app/scripts/start.sh ./scripts/start.sh
COPY --from=build --chown=node:node /migrator/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=build --chown=node:node /migrator/node_modules/postgres ./node_modules/postgres

RUN sed -i 's/$//' scripts/start.sh && chmod +x scripts/start.sh

USER node
EXPOSE 3000

# Dokploy polls this. It reports unhealthy when the database is unreachable, so
# a bad connection string fails the deployment instead of serving broken pages.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Set RUN_MIGRATIONS_ON_BOOT=true to apply migrations before the server starts.
# A failure there aborts the boot rather than serving a half-applied schema.
CMD ["/bin/sh", "scripts/start.sh"]
