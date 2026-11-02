# Spike result: the default `next build` (Turbopack) standalone output already
# traces `pg` and its dependencies into node_modules, because app code imports it
# (src/app/api/health/db/route.ts). No webpack build was needed. Packages only used by
# standalone scripts (migrate, seed: `@node-rs/argon2` and its native linux binary) are
# not traced, so the runner starts from the full production node_modules and the
# standalone output is copied on top of it.
#
# The last stage is the runner, so a plain `docker build` always produces
# the production image. Runtime configuration (database URL, app origin, seed settings)
# is never set here; it comes from the environment at run time.
FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:26-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src
COPY tests ./tests
COPY messages ./messages
COPY public ./public
COPY scripts ./scripts
COPY db ./db
RUN npm run build

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m app
# Production dependencies first; the standalone copy below overwrites identical files.
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
# Standalone server, traced node_modules and package.json
COPY --from=build --chown=app:app /app/.next/standalone ./
# Standalone output does not include static assets
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Standalone output does not include public/
COPY --from=build --chown=app:app /app/public ./public
# Migrations and seed, plus the scripts that apply them at start-up
COPY --from=build --chown=app:app /app/db ./db
COPY --from=build --chown=app:app /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=app:app /app/scripts/lib/password.mjs ./scripts/lib/password.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrate (and seed when SEED_ON_BOOT=true), then replace the shell with the server so it
# receives signals directly. No shell entrypoint file: a CRLF checkout on Windows would break it.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
