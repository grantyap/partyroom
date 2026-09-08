FROM beveradb/audio-separator:latest AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/

USER root
WORKDIR /workspace/apps/stem-worker
COPY packages/activity-worker-python /workspace/packages/activity-worker-python
COPY apps/stem-worker/pyproject.toml apps/stem-worker/uv.lock ./
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv --system-site-packages \
    && uv sync --frozen --no-dev --no-install-project


FROM beveradb/audio-separator:latest

USER root
WORKDIR /workspace/apps/stem-worker
COPY --from=dependencies /workspace/apps/stem-worker/.venv ./.venv
COPY apps/stem-worker/app ./app

ENV PATH="/workspace/apps/stem-worker/.venv/bin:$PATH" \
    HOST=0.0.0.0 \
    PORT=4200 \
    WORK_DIR=/work \
    MODEL_DIR=/models

EXPOSE 4200

ENTRYPOINT []
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4200"]
