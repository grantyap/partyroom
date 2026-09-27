# Workflow migration: two ordinary Coolify deployments

The human steps are to advance `develop` and `main` to the two release commits in order, push `main` after each advance, and inspect Coolify. No Coolify Terminal command, migration runner, environment-variable edit, or manual backfill is part of the deployment.

Coolify stopped the old web, backend, and workers before starting replacements in the successful September 23, 2026 deployment. The web container had no running replacement for about 43 seconds. These releases tolerate that restart and keep accepting submissions after each deployment; they do **not** make Coolify's Compose rollout zero downtime. Both releases must use the same production `data` volume. Check that Coolify's existing volume backup is healthy before the first push.

## Release 1: queue new work, finish v1

Advance both branches to the tip of `codex/workflow-drain-prep`, then push `main`. Coolify's `backend-deploy` service sets `MEDIA_WORKFLOW_DRAIN=1` before publishing the preparatory functions. New submissions and reprocessing requests are accepted and queued; existing published media remains playable. Existing v1 workflows and workers continue to completion. The `drain-monitor` service starts automatically and logs one `workflowMigration` JSON summary each minute.

In Coolify, inspect the `drain-monitor` runtime logs. Wait for `ready: true`, with `activeJobs`, `activeEnrichments`, and `activeActivities` all zero. The monitor only reports ready after ten continuous minutes of clean scans. `queued` may be nonzero and may increase while users submit work. If the monitor logs an error or never becomes ready, keep release 1 deployed and investigate the workers and backend logs. Do not deploy release 2 while it says `ready: false`.

## Release 2: route v2 and release the queue

After the ready signal, advance both branches to the tip of `codex/workflow-online-migration-v2`, then push `main`. Coolify's `backend-deploy` service checks the ready signal against the same Convex instance and performs a live v1-work scan **before** publishing v2 functions. It fails closed if the signal is missing or contradicted by live work. Once v2 is published, it checks again, switches the durable routing version to v2, and opens new submissions. The `queue-release` service then starts queued jobs under v2; it retries automatically if it exits with an error. No second push is required to run a data backfill.

Inspect Coolify for a successful `backend-deploy`, a successful `queue-release`, healthy web/backend/workers, new submissions completing, and existing published playback. If `backend-deploy` fails **before** routing changes, restore release 1 by pushing its commit to `main` and investigate the gate; queued work remains queued. Once routing has changed to v2, keep v2 deployed and repair forward. Do not redeploy v1 over started v2 workflows.

## Compatibility left for a later migration

The v2 schema accepts old rows and legacy projections. It does not contract tables or delete historical artifacts during this rollout. `TODO(deprecation)` comments mark fields and schema arms that can be removed only in a separate migration after production has run safely on v2 and the rollback window closes. The manual preflight/apply/verify runner has been removed from this deployment path.

This procedure is rehearsable with the same two ordinary deployments against an isolated restored copy. A successful local rehearsal does not certify production: the production monitor's ready signal, volume identity, and post-deployment health still have to be observed.
