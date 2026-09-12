FROM ghcr.io/get-convex/convex-backend:latest AS convex

FROM oven/bun:1.4.2-debian

WORKDIR /workspace
COPY package.json bun.lock ./
COPY packages/activities/package.json ./packages/activities/
COPY packages/activity-worker/package.json ./packages/activity-worker/
COPY packages/backend/package.json ./packages/backend/
COPY packages/capabilities/package.json ./packages/capabilities/
COPY packages/config/package.json ./packages/config/
COPY packages/env/package.json ./packages/env/
COPY packages/media-activities/package.json ./packages/media-activities/
RUN bun install --frozen-lockfile --filter @partyroom/backend

COPY packages ./packages
RUN bunx tsc --noEmit -p packages/backend/convex/tsconfig.json
COPY scripts/deploy-convex.sh /usr/local/bin/deploy-convex
COPY --from=convex /convex/generate_key /usr/local/bin/generate_key

WORKDIR /workspace/packages/backend
ENTRYPOINT ["deploy-convex"]
