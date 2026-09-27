# Crash-recovery test

Run the test from the repository root:

```sh
bun scripts/restart-test/run.ts
```

Requirements:

- Docker;
- installed workspace dependencies;
- `packages/activity-worker-python/.venv`;
- free ports `33210` and `33211`.

The test takes several minutes because it waits for a real 30-second lease to
expire. On macOS, keep the machine awake with:

```sh
caffeinate -i bun scripts/restart-test/run.ts
```

## What the test does

The runner copies the backend into a temporary directory and starts a disposable
Convex container with its own database and storage. It injects the test-only
functions from `probe.ts.fixture` into that copy; those functions are never
deployed with the application. The runner starts the TypeScript and Python
workers against the temporary backend, then removes the container and workers
when the test finishes or fails.

The temporary directory printed at startup contains the worker logs and the
JSON results after the run.

The test uses deterministic LRCLIB data and lightweight media fixtures. It
still exercises the real media and enrichment workflows, activity component,
worker HTTP endpoints, TypeScript and Python runtimes, validators, and artifact
storage. It checks orchestration and data integrity, not codec or model quality.

## Failure scenarios

The test sends `SIGKILL` in these scenarios:

- the backend dies while a TypeScript handler holds a live lease;
- the TypeScript worker dies after uploading an artifact, then restarts;
- the backend remains down past a killed worker's lease deadline;
- the Python worker dies after uploading lyrics, then retries the activity;
- a completion is committed but its HTTP response is lost;
- an identical completion is retried and a conflicting completion is rejected;
- published video and lyrics remain available while enrichment recovers;
- scratch and abandoned artifacts are removed while all nine published artifacts
  remain readable after another backend restart.

The test also checks stale-token rejection, artifact provenance across retries,
absence of duplicate domain rows, and absence of duplicate activity scheduling.

The backend always restarts against the same temporary database and storage.
Destroying that storage, upgrading incompatible workflow code, and validating
codec or model output are outside this test's scope.
