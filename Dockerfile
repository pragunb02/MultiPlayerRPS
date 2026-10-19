# ClassiCade production image (CC-026): the server, serving the built web app. Used by docker-compose for local
# runs and checked in CI; portable to any container host (ADR-005, CC-028).

# ---- build: install everything, build the web app, then drop dev dependencies -----------------------------------
FROM node:24-alpine AS build
WORKDIR /app
# Manifests first, so dependency layers are cached until a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/games/package.json packages/games/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:web && npm prune --omit=dev --no-audit --no-fund

# ---- runtime: only what the server needs, as an unprivileged user -------------------------------------------------
FROM node:24-alpine AS runtime
# HOST=0.0.0.0 inside the container only: the server's own default is 127.0.0.1, which a published port cannot reach.
# What is reachable from outside is decided where the port is published, and docker-compose.yml publishes it on
# 127.0.0.1 only (CC-287).
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 4000
# /health is 200 only while the database is connected (same check Render uses).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/src/index.js"]
