# Production smoke checks

Run these after a rollout has finished, before accepting it as healthy. Existing
container health checks only establish that each individual process is ready;
they do not detect two healthy deployments serving the same public domains.

## Docker host and public HTTP

From a checkout on the deployment Docker host (Python 3 and Docker required):

```sh
python3 scripts/check_production.py COOLIFY_APPLICATION_UUID --origin https://partyroom.lol
```

This read-only check fails unless there is exactly one healthy instance of each
production service, all in the same Compose project, and both deployment jobs
have exited successfully in that project. It discovers containers by the stable
application UUID in their names, across **all** Compose projects. Filtering by
only the latest Compose project would miss the orphan that caused the incident.
Stopped old deployments are allowed. Login rendering and the public session
endpoint are also checked. No Docker environment values or credentials are logged.

Keep the custom Coolify build/start commands on a stable project name when using
the NVIDIA overlay; include `--project-name COOLIFY_APPLICATION_UUID` before
`-f docker-compose.yaml -f docker-compose.nvidia.yaml`. Changing the project name
alone does not clean up existing projects. Inspect and stop confirmed old stacks
without deleting their data volumes.

## Authenticated room creation

In the Codex computer-use REPL, with a signed-in Partyroom tab:

```js
const { checkRoomCreation } = await import("/absolute/path/to/partyroom/scripts/check-room-creation.mjs");
await checkRoomCreation(tab);
```

The check clicks the real Create room button, waits for the room to open, reloads
it, then confirms it appears in Your rooms and rejects browser errors emitted during
the check. A successful login page or HTTP 200
alone is insufficient: the incident failed at the authenticated Convex mutation.
One empty room is created; the app's normal empty-room expiry cleans it up.
The account must have room-creation access (including Premium when that ships).
Credentials are supplied through normal sign-in, never committed or printed.

For unattended runs, install dependencies with `bun install --frozen-lockfile`
and Chromium with `bunx playwright install --with-deps chromium`, then provide a
dedicated account through `SMOKE_EMAIL` and `SMOKE_PASSWORD`, and set
`SMOKE_ORIGIN` to the HTTPS origin. Run:

```sh
node scripts/check-room-creation-unattended.mjs
```

The process exits nonzero on login, room, persistence, or browser errors; it does
not print credentials or browser error details. Invoke the Docker-host check from
separately on the Docker host; the release workflow does not run it. Do not rely on Coolify's post-deployment hook
as a failure gate: in Coolify 4.4.6 it marks the deployment complete first and logs
post-command failures without failing the deployment.

## Media processing

For a release touching workers or media orchestration, add the agreed test song
in the browser and verify source resolution, download, separation, final video,
advancing playback, and synchronized lyrics. Video readiness alone does not prove
that the asynchronous lyric enrichment finished successfully. Keep this heavier
check separate from the fast room-creation smoke.

## Regression tests

```sh
python3 -m unittest discover -s scripts -p test_check_production.py -v
```

Includes duplicate backends in different projects, unhealthy/restarting services,
missing services, failed/unfinished deployment jobs, and stopped old deployments.
