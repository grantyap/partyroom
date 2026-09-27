# Online workflow-state migration

This change has **two deployable commits**. Deploy the first commit (`codex/workflow-drain-prep`) before the redesign commit. Do not deploy the redesign over the original `develop` runtime: its workflow and worker protocol replaces v1 handlers, so every v1 workflow, leased activity, retry, and completion delivery must finish first.

New media submissions remain accepted during the drain and wait in `queued`. Existing playback and v1 work continue. Reprocessing retains the published asset while its new job waits. The drain is controlled by the Convex environment variable `MEDIA_WORKFLOW_DRAIN=1`, so a normal web/worker deploy does not change routing by itself.

## Rehearse with a production snapshot

Export the complete production Convex deployment, including application tables, component tables, and file storage. Restore into an isolated self-hosted deployment. Use the **same images and configuration** planned for production. Set `MIGRATION_TARGET=restored-copy` in its Compose environment, and use `--restored-copy` on every command below. Exercise submission, reprocessing, playback, in-flight v1 completion, queued v2 completion, and a rollback to the preparatory release before routing changes.

A local success cannot guarantee production success: live data volume, current leases, worker availability, storage, and new writes can differ. Production must pass its own drain scans and post-cutover smoke test. Keep a current backup and a tested restore procedure before the first production deploy.

## Production sequence

All `docker compose` commands below run against the production Compose project. Set `MIGRATION_TARGET=production` explicitly. The `--no-deps` flag prevents the one-shot runner from starting or redeploying the backend. Reports live in the `migration_reports` volume and are printed as `/workspace/migration-reports/...` paths.

### 1. Deploy the preparatory release

Deploy `codex/workflow-drain-prep` through the normal release path. Confirm the backend, v1 workers, and playback are healthy. Start the drain:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner start --production
```

The command sets `MEDIA_WORKFLOW_DRAIN=1` and writes a report. Verify a new submission is accepted and remains queued, while an existing v1 run finishes. Reprocessing should keep the published asset playable. Continue to run:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner status --production
```

Do not deploy the redesign while any `jobs.active`, `enrichments.active`, or `activities.active` IDs remain. Keep the v1 workers online. Save two clean status report paths at least ten minutes apart; this exceeds the current media schedule-to-close timeout and retry interval. If any activity, delivery, or workflow remains active, investigate it instead of cancelling it to clear the gate. Check that the queued count is within operational capacity.

Before the redesign deploy, rollback is simple: remove the drain and resume the queued jobs with the preparatory release's `resume-v1` command. This starts those jobs under v1 and may invalidate published revisions on reprocess, matching the old behavior:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner resume-v1 --production
```

### 2. Deploy the redesign release

Deploy the head of `codex/workflow-online-migration-v2` through the normal release path. Keep `MEDIA_WORKFLOW_DRAIN=1`; new requests continue to queue. Run the drain status again. If any old work appears, stop the cutover and investigate. The v1 runtime has been replaced, so restore the preparatory release if the issue requires a v1 handler. Do not use the redesign release to restart v1 workflows.

Route new work to v2, using the two clean preparatory reports. This command performs a third live scan before changing the durable routing version:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner route-v2 --production --report-a=/workspace/migration-reports/FIRST.json --report-b=/workspace/migration-reports/SECOND.json
```

Release queued work under v2 while submissions are still being queued, then open new submissions. The open command removes the drain flag and makes one more queued-job pass. If traffic is high, repeat `release-v2` until status shows no queued jobs:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner release-v2 --production
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner open-v2 --production
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps drain-runner status --production
```

The durable routing version remains v2 if a runner exits partway through. `release-v2` is idempotent: each job is started and attached in one Convex mutation; rerun it after a failure. If v2 execution fails, stop new starts by setting `MEDIA_WORKFLOW_DRAIN=1`, preserve queued and active v2 jobs, and repair forward. Do not redeploy v1 over a started v2 workflow.

### 3. Backfill and verify

The backfill only normalizes eligible terminal records and adopts validated retained artifacts. It does not switch routing. Run it separately after v2 is serving traffic:

```sh
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps migration-runner preflight --production
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps migration-runner apply --production
MIGRATION_TARGET=production docker compose --profile migration run --rm --no-deps migration-runner verify --production
```

Resolve reported blockers, then repeat `apply` and `verify`. Confirm zero blockers, zero legacy projections, zero pending adoptions, zero active v1 workflows and activities, and no queued jobs. Perform a production create → complete → publish → playback smoke test and confirm existing published playback. Keep the compatibility schema and retained history through the rollback window. This branch provides no `finalize` or `cleanup` command; contraction and deletion require separate, reviewed work after production has remained healthy.

## Why the gate matters

The workflow journal records function references and worker protocol. The redesign changes both. The preparatory release gives old journals and deliveries time to finish while new requests wait. The two clean scans plus a fresh third scan reduce the race where a delayed callback appears just after a scan. This is still an operational gate, not a proof that local behavior implies production behavior; production telemetry, backup, worker health, and the production smoke test remain required.
