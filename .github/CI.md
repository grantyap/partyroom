# Continuous integration

`CI` runs on pull requests targeting `develop` or `main`, pushes to those branches,
and manual dispatch. It needs no production credentials. Make **CI required** the
required status check in branch protection/rulesets for both branches after the
first workflow run. The aggregate check fails when any dependency fails or is
cancelled, so a partial run cannot report success.

The workflow runs Bun and Vitest suites separately, checks TypeScript and Svelte,
verifies generated activity contracts, and runs Python unittest suites with Python
3.12 and frozen uv dependencies. The lyrics job uses CPU dependencies. Model
inference is mocked in unit tests; no model downloads or GPU are needed.

Production web and backend-deploy images are built independently on Linux. The
web image is also started and its login page rendered without source mounts.
Public build URLs are test fixtures, never production secrets. Bun is pinned to
1.4.4 in CI, packageManager, and every Bun Docker stage: 1.4.2 attempts to rewrite
the current workpool dependency resolution and rejects the frozen lockfile.

`Crash recovery` runs daily at 08:30 UTC on the default branch, or manually on a
selected branch. It runs the existing restart harness against a disposable Convex
database, not production, and retains logs/results for seven days. See
`scripts/restart-test/README.md` for the scenarios it covers.

## Production release follow-up

These workflows validate changes; Coolify's current push webhook still deploys
independently. Before treating CI as a production release gate:

1. Require `CI required` on both branches, including the promotion path to `main`.
2. Configure a trusted release job with a scoped Coolify deployment credential,
   the application UUID, and private access to the deployment Docker host. Only
   trusted `main` commits should receive these credentials. Keep pull request
   jobs on hosted runners without production access.
3. Disable the independent Coolify push deployment when the replacement release
   job is ready. Serialize the complete release and verify that the requested SHA
   matches the Coolify deployment SHA; an API request being accepted is not a
   completed deployment.
4. Wait for that deployment's successful result, then run
   `scripts/check_production.py` on the Docker host and the authenticated
   room-creation smoke with a dedicated test account. Fail the GitHub release if
   either fails. See `scripts/production-smoke.md`; do not use a post-deployment
   hook alone as the release gate.
   `scripts/check_coolify_deployment.py DEPLOYMENT_UUID FULL_COMMIT_SHA` polls
   the Coolify API using `COOLIFY_URL` and `COOLIFY_TOKEN` in the environment,
   fails on timeout, failure, or a mismatched commit, and does not print API logs.
   It checks a deployment after it has been queued; it cannot prevent Coolify
   from deploying a different commit. The complete release workflow must address
   that race and run both smoke checks before it can replace the push webhook.
5. Pin floating backend/dashboard/base-image references to tested immutable
   versions, and test upgrade/migration recovery before enabling automated rollback.
   A previous application image does not reverse database migrations.

Real GPU inference and a complete media/playback check need a separate trusted
GPU runner and fixtures. Run them for worker releases; the fast checks do not
establish model accuracy, accelerator compatibility, or successful end-to-end media
processing. Publishing immutable images once and deploying their digests is a
later improvement; this workflow does not publish images.
