# Spike result: the default `next build` (Turbopack) standalone output already
# traces `pg` and its dependencies into node_modules, because app code imports it
# (src/app/api/health/db/route.ts). No webpack build and no manual node_modules
# copy was needed. Packages only used by standalone scripts (migrate, seed) are not
# traced and must be copied into the runner explicitly when those scripts land.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs ./
COPY src ./src
COPY tests ./tests
COPY messages ./messages
COPY public ./public
COPY scripts ./scripts
# Add `COPY db ./db` here once the db/ folder exists.
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN groupadd -g 10001 app && useradd -u 10001 -g app -m app
# Standalone server, traced node_modules and package.json
COPY --from=build --chown=app:app /app/.next/standalone ./
# Standalone output does not include static assets
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Standalone output does not include public/
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
