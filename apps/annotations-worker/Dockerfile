FROM python:3.12-slim AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/

WORKDIR /workspace/apps/annotations-worker
COPY packages/activity-worker-python /workspace/packages/activity-worker-python
COPY apps/annotations-worker/pyproject.toml apps/annotations-worker/uv.lock ./
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --no-install-project


FROM python:3.12-slim

WORKDIR /workspace/apps/annotations-worker
COPY --from=dependencies /workspace/apps/annotations-worker/.venv ./.venv
COPY apps/annotations-worker/app ./app

ENV PATH="/workspace/apps/annotations-worker/.venv/bin:$PATH" \
    PORT=4400 \
    WORK_DIR=/work

EXPOSE 4400
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4400"]
