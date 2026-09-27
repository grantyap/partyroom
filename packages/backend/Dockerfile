FROM ghcr.io/get-convex/convex-backend:2cbcf8179207eb4521360e6d81ebee5e7abbfa07 AS convex

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
COPY scripts/workflow-drain.ts ./scripts/workflow-drain.ts
COPY scripts/migrate-workflow-state.ts ./scripts/migrate-workflow-state.ts
RUN bunx tsc --noEmit -p packages/backend/convex/tsconfig.json
COPY scripts/deploy-convex.sh /usr/local/bin/deploy-convex
COPY scripts/run-workflow-drain.sh /usr/local/bin/run-workflow-drain
COPY scripts/run-workflow-migration.sh /usr/local/bin/run-workflow-migration
COPY --from=convex /convex/generate_key /usr/local/bin/generate_key

WORKDIR /workspace/packages/backend
ENTRYPOINT ["deploy-convex"]
