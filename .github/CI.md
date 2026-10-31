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

## Production releases

`Production release` is disabled until the repository variable
`PRODUCTION_RELEASE_ENABLED` is set to `true`. After a successful push CI run
on `main`, it calls Coolify's deploy webhook using the protected `production`
environment. Pull request and manually dispatched CI runs cannot deploy.

Before enabling the workflow, require `CI required` on `develop` and `main`;
restrict the production environment to trusted `main` releases. Store
`COOLIFY_DEPLOY_WEBHOOK` and a Coolify deploy-only `COOLIFY_DEPLOY_TOKEN` as
production environment secrets. Disable Coolify's independent Git deploy-on-push
only when the replacement is ready; otherwise it bypasses CI. After cutover,
verify that a successful push requests a deployment and a failed CI run does not.
The workflow must exist on the default branch for `workflow_run` to fire.

A successful request means Coolify accepted it, not that deployment succeeded.
Check Coolify's deployment logs and notifications and run the checks in
`scripts/production-smoke.md` after deployment. A branch can advance while CI
runs, so this webhook does not guarantee Coolify deploys the commit that passed
that particular CI run. This workflow does not publish immutable images.

Real GPU inference and a complete media/playback check need a separate trusted
GPU runner and fixtures. Run them for worker releases; the fast checks do not
establish model accuracy, accelerator compatibility, or successful end-to-end media
processing.
