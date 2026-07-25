FROM debian:bookworm-slim AS media-tools

ARG TARGETARCH
ARG DENO_VERSION=2.8.1
ARG YT_DLP_VERSION=2026.07.04
ARG FFMPEG_RELEASE=autobuild-2026-07-21-16-07
ARG FFMPEG_VERSION=N-125708-gccc57378b3

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
      amd64) \
        deno_target=x86_64-unknown-linux-gnu; \
        deno_sha256=2d7bb6195226ac832e0bf7109a115f0af65ee69ac797a4bbde5b27a06cc242d9; \
        yt_dlp_asset=yt-dlp_linux; \
        yt_dlp_sha256=6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae; \
        ffmpeg_arch=linux64; \
        ffmpeg_sha256=edd553a51f2d1dd52542ea41770bf20cfdda32caef1d9b9f3554a75b3a7fa340 ;; \
      arm64) \
        deno_target=aarch64-unknown-linux-gnu; \
        deno_sha256=67e9df91870fd0af700df924173e3009ea7ff6956e2c3c3bb86065d6070d0fd6; \
        yt_dlp_asset=yt-dlp_linux_aarch64; \
        yt_dlp_sha256=b6ce97646773070d7a7ffd6bbbdcaecb47c48483909c54c915bf08a7a9b5e0b1; \
        ffmpeg_arch=linuxarm64; \
        ffmpeg_sha256=ea6990e25bd9b2cc2b18e9cb931156b524712b5eb2cf4e8a56ffbe8eedca742c ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && deno_archive="deno-${deno_target}.zip" \
    && curl -fsSL \
      "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/${deno_archive}" \
      -o "/tmp/${deno_archive}" \
    && echo "${deno_sha256}  /tmp/${deno_archive}" | sha256sum -c - \
    && curl -fsSL \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${yt_dlp_asset}" \
      -o /tmp/yt-dlp \
    && echo "${yt_dlp_sha256}  /tmp/yt-dlp" | sha256sum -c - \
    && ffmpeg_archive="ffmpeg-${FFMPEG_VERSION}-${ffmpeg_arch}-gpl.tar.xz" \
    && curl -fsSL \
      "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/${ffmpeg_archive}" \
      -o "/tmp/${ffmpeg_archive}" \
    && echo "${ffmpeg_sha256}  /tmp/${ffmpeg_archive}" | sha256sum -c - \
    && mkdir -p /tmp/ffmpeg /out \
    && unzip -q "/tmp/${deno_archive}" -d /tmp/deno \
    && tar -xJf "/tmp/${ffmpeg_archive}" -C /tmp/ffmpeg --strip-components=1 \
    && install -m 0755 /tmp/deno/deno /out/deno \
    && install -m 0755 /tmp/yt-dlp /out/yt-dlp \
    && install -m 0755 /tmp/ffmpeg/bin/ffmpeg /out/ffmpeg \
    && install -m 0755 /tmp/ffmpeg/bin/ffprobe /out/ffprobe

FROM oven/bun:1.3.14-debian

COPY --from=media-tools /out/deno /usr/local/bin/deno
COPY --from=media-tools /out/yt-dlp /usr/local/bin/yt-dlp
COPY --from=media-tools /out/ffmpeg /usr/local/bin/ffmpeg
COPY --from=media-tools /out/ffprobe /usr/local/bin/ffprobe

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
