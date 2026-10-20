# Techcadd ERP - production image (build on Coolify from this repo).
# Stage 1: install + build. Stage 2: slim runtime with production dependencies only.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build needs no secrets: pages that read the database are rendered on request.
RUN pnpm exec next build && pnpm prune --prod

FROM node:22-alpine AS runtime
RUN corepack enable && apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/lib/db/migrations ./lib/db/migrations
COPY --from=build /app/scripts/migrate-prod.mjs ./scripts/migrate-prod.mjs
COPY --from=build /app/scripts/admin-reset.mjs ./scripts/admin-reset.mjs
COPY --from=build /app/scripts/create-db-login.mjs ./scripts/create-db-login.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Applies pending database migrations (set RUN_MIGRATIONS=false to skip), then starts the app.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" != \"false\" ]; then node scripts/migrate-prod.mjs || exit 1; fi; exec node_modules/.bin/next start -p ${PORT}"]
