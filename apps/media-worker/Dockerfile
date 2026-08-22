FROM debian:bookworm-slim AS media-tools

ARG TARGETARCH
ARG DENO_VERSION=2.8.1

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

FROM oven/bun:1.3.14-debian

COPY --from=media-tools /out/deno /usr/local/bin/deno
COPY --from=media-tools /out/yt-dlp /usr/local/bin/yt-dlp

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --production --filter @partyroom/media-worker

WORKDIR /workspace/apps/media-worker

ENV HOST=0.0.0.0 \
    PORT=4100 \
    WORK_DIR=/work

EXPOSE 4100

CMD ["bun", "src/server.ts"]
