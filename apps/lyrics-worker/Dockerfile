FROM python:3.12-slim-trixie AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/
ENV UV_LINK_MODE=copy

WORKDIR /workspace/apps/lyrics-worker
COPY packages/activity-worker-python /workspace/packages/activity-worker-python
COPY apps/lyrics-worker/pyproject.toml apps/lyrics-worker/uv.lock ./
ARG PYTORCH_ACCELERATOR=cpu
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --extra "${PYTORCH_ACCELERATOR}"


FROM python:3.12-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/apps/lyrics-worker
COPY --from=dependencies /workspace/apps/lyrics-worker/.venv ./.venv
COPY apps/lyrics-worker/app ./app

ENV PATH="/workspace/apps/lyrics-worker/.venv/bin:$PATH" \
    HF_HOME=/models \
    PORT=4300 \
    WORK_DIR=/work

EXPOSE 4300
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4300"]
