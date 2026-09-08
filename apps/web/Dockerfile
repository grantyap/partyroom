FROM oven/bun:1.4.2-debian AS build

WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/activities/package.json ./packages/activities/
COPY packages/activity-worker/package.json ./packages/activity-worker/
COPY packages/backend/package.json ./packages/backend/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/config/package.json ./packages/config/
COPY packages/env/package.json ./packages/env/
COPY packages/media-activities/package.json ./packages/media-activities/
RUN bun install --frozen-lockfile --filter web

COPY . .
ARG PUBLIC_CONVEX_URL
ARG PUBLIC_CONVEX_SITE_URL
RUN if [ -z "$PUBLIC_CONVEX_URL" ] || [ -z "$PUBLIC_CONVEX_SITE_URL" ]; then \
      echo "PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL are required" >&2; exit 1; \
    fi
ENV PUBLIC_CONVEX_URL=$PUBLIC_CONVEX_URL \
    PUBLIC_CONVEX_SITE_URL=$PUBLIC_CONVEX_SITE_URL
RUN bun run --cwd apps/web build

FROM oven/bun:1.4.2-debian

WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/activities/package.json ./packages/activities/
COPY packages/activity-worker/package.json ./packages/activity-worker/
COPY packages/backend/package.json ./packages/backend/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/config/package.json ./packages/config/
COPY packages/env/package.json ./packages/env/
COPY packages/media-activities/package.json ./packages/media-activities/
RUN bun install --frozen-lockfile --production --filter web

COPY --from=build /workspace/apps/web/build ./build

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production
EXPOSE 3000

CMD ["bun", "build/index.js"]
