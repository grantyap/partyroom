FROM oven/bun:1.4.4-debian AS application
WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/metadata-worker/package.json ./apps/metadata-worker/
COPY packages/activity-worker/package.json ./packages/activity-worker/
COPY packages/activities/package.json ./packages/activities/
COPY packages/media-activities/package.json ./packages/media-activities/
COPY packages/config/package.json ./packages/config/
COPY packages/env/package.json ./packages/env/
RUN bun install --frozen-lockfile --production --filter @partyroom/metadata-worker
COPY apps/metadata-worker/src ./apps/metadata-worker/src
COPY packages/activity-worker/src ./packages/activity-worker/src
COPY packages/activities/src ./packages/activities/src
COPY packages/activities/protocol.ts ./packages/activities/
COPY packages/media-activities/src ./packages/media-activities/src
RUN bun build apps/metadata-worker/src/server.ts apps/metadata-worker/src/inference.ts --target=bun --outdir=/out --minify

FROM ollama/ollama:0.40.11
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/*
COPY --from=application /usr/local/bin/bun /usr/local/bin/bun
COPY --from=application /out/ /workspace/
ENV HOST=0.0.0.0 PORT=4500 OLLAMA_MODELS=/models
EXPOSE 4500
ENTRYPOINT ["bun", "/workspace/server.js"]
