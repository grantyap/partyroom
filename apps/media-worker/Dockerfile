FROM debian:bookworm-slim AS media-tools

ARG TARGETARCH
ARG DENO_VERSION=2.8.1

# Keep yt-dlp on releases/latest: extractor fixes must ship without a source change.
# Never pin yt-dlp to a version or checksum.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
      amd64) \
        deno_target=x86_64-unknown-linux-gnu; \
        deno_sha256=2d7bb6195226ac832e0bf7109a115f0af65ee69ac797a4bbde5b27a06cc242d9; \
        yt_dlp_asset=yt-dlp_linux ;; \
      arm64) \
        deno_target=aarch64-unknown-linux-gnu; \
        deno_sha256=67e9df91870fd0af700df924173e3009ea7ff6956e2c3c3bb86065d6070d0fd6; \
        yt_dlp_asset=yt-dlp_linux_aarch64 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && deno_archive="deno-${deno_target}.zip" \
    && curl -fsSL \
      "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${deno_archive}" \
      -o "/tmp/${deno_archive}" \
    && echo "${deno_sha256}  /tmp/${deno_archive}" | sha256sum -c - \
    && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${yt_dlp_asset}" \
      -o /tmp/yt-dlp \
    && mkdir -p /out \
    && unzip -q "/tmp/${deno_archive}" -d /tmp/deno \
    && install -m 0755 /tmp/deno/deno /out/deno \
    && install -m 0755 /tmp/yt-dlp /out/yt-dlp

FROM oven/bun:1.4.0-debian AS application

WORKDIR /workspace
COPY package.json bun.lock ./
COPY apps/annotations-worker/package.json ./apps/annotations-worker/package.json
COPY apps/lyrics-worker/package.json ./apps/lyrics-worker/package.json
COPY apps/stem-worker/package.json ./apps/stem-worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/activities ./packages/activities
COPY packages/activity-worker ./packages/activity-worker
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/config ./packages/config
COPY packages/env ./packages/env
COPY packages/media-activities ./packages/media-activities
COPY apps/media-worker ./apps/media-worker
RUN bun install --frozen-lockfile --production --filter @partyroom/media-worker \
    && bun build apps/media-worker/src/server.ts \
      --target=bun \
      --outfile=/out/server.js \
      --minify


FROM oven/bun:1.4.0-debian

COPY --from=media-tools /out/deno /usr/local/bin/deno
COPY --from=media-tools /out/yt-dlp /usr/local/bin/yt-dlp

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY --from=application /out/server.js ./server.js

ENV HOST=0.0.0.0 \
    PORT=4100 \
    WORK_DIR=/work

EXPOSE 4100

CMD ["bun", "server.js"]
