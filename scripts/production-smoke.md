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

These are explicit smoke checks, not an unattended monitor. For unattended runs,
provide a dedicated test account and a browser runner, and invoke the Docker-host
check from the release runner too. Do not rely on Coolify's post-deployment hook
as a failure gate: in Coolify 4.4.6 it marks the deployment complete first and logs
post-command failures without failing the deployment.

## Media processing

For a release touching workers or media orchestration, add the agreed test song
in the browser and verify source resolution, download, separation, final video,
advancing playback, and synchronized lyrics. Video readiness alone does not prove
that the asynchronous lyric enrichment finished successfully. Keep this heavier
check separate from the fast room-creation smoke.

## Payment readiness and acceptance

Use the environment configuration actually supplied to the target backend, through
a private file or the deployment environment. Do not paste secret values into
commands, issue comments, or screenshots. Run from the repository root:

```sh
bun --env-file /private/path/to/target.env scripts/check-payment-readiness.ts sandbox
# Only inspect production when the file contains the intended live configuration:
bun --env-file /private/path/to/production.env scripts/check-payment-readiness.ts live
```

The script performs only reads. It checks the current USD 4.99 monthly price,
Stripe mode, default portal, webhook events/API version, sender domain, and
required configuration. A copied env file is not proof of deployed settings:
compare the configuration source with the deployed Convex environment privately.
Exit 1 means a configuration/read check failed; exit 2 means automatic checks
passed but manual checks remain; exit 0 means no checks remain unverified. The
current script always leaves delivery and retry-policy evidence to the walkthrough.
`CONFIGURED` means present, `VERIFIED` means checked against an API, and
`UNVERIFIED` requires operator evidence. These states are deliberately separate.
Sending-only Resend keys can leave the domain check unverified; inspect its status
in Dashboard without expanding key permissions solely for this check.

Configure the Stripe destination at the public Convex HTTP origin plus
`/stripe/webhook`, using the destination's signing secret. Events:
`customer.created/updated/deleted`,
`customer.subscription.created/updated/deleted`, `checkout.session.completed`,
and `invoice.created/finalized/updated/paid/payment_failed`.
Match the destination API version to the installed Stripe SDK. Configure the
default portal for invoices, payment updates and period-end cancellation; disable
plan/quantity changes. Retry settings must not cancel a subscription before the
app's seven-day renewal grace ends. Send failure/recovery notices through Stripe's
billing settings. Verify the sender domain in Resend, disable link/open tracking
for auth emails, and configure `/resend/webhook` for `email.*` events with its own
signing secret. A 400 response to an unsigned request proves neither secret
correctness nor successful delivery.

Run the following in a designated Stripe sandbox with disposable accounts and a
designated inbox. Use sandbox test clocks for time-dependent cases. Do not run
live charges, refunds, recipient imports, or billing configuration writes as part
of the walkthrough. Any operator-run live validation needs separate authorization.

- [ ] Record the tested commit, environment, browser/device and configuration report.
- [ ] Sign up; receive/open the verification email; check resend and expired links.
      Verify in another tab/device and use **I've verified** in the original tab.
- [ ] Confirm an unverified user cannot purchase. Complete a sandbox Checkout
      requiring card authentication; verify access comes from the webhook, then
      go to Rooms and create a room.
- [ ] Join from a fresh incognito guest session and a mobile guest. Queue a test
      song, wait for processing, and verify audio/video/lyrics and shared playback.
- [ ] Abandon/cancel Checkout and retry. Repeat purchase clicks in two tabs;
      confirm only one subscription exists. Complete payment without returning
      to the app; reopening it must show Premium.
- [ ] Delay webhook delivery for over 60 seconds. Check refresh, Manage billing,
      support guidance and continued automatic confirmation. Replay older signed
      customer/subscription/invoice events; ownership and cancellation must hold.
- [ ] Request a password reset. Verify an unknown email has the same confirmation.
      Reset once; verify the old password fails, the new one works, and reused,
      expired and invalid links offer a new request. Check previous sessions end.
- [ ] Fail a renewal; verify the seven-day grace deadline, exact expiry and room
      pause for host/guests. Recover payment and confirm access returns.
- [ ] Cancel at period end; verify access until the deadline and denial afterward.
      Test immediate cancellation and a new purchase after terminal cancellation.
- [ ] Import/claim a complimentary sandbox account using a verified matching
      email. Confirm no paid Checkout is required, reruns preserve revoked grants,
      and an already-paid import stops for review without changing subscriptions.
- [ ] Confirm signed Stripe and Resend deliveries reached the intended backend
      successfully, and verify both email types arrived in the designated inbox.
- [ ] Run the Docker-host topology check, authenticated room-creation check and
      media-processing smoke described above against the release environment.

Attach redacted results to issue #10 and tracker #1. Leave unavailable scenarios
unchecked; a passing unit suite or written walkthrough does not complete #10.
Report failures as reproducible issues, and include links to the fixing PRs.

## Regression tests

```sh
python3 -m unittest discover -s scripts -p test_check_production.py -v
```

Includes duplicate backends in different projects, unhealthy/restarting services,
missing services, failed/unfinished deployment jobs, and stopped old deployments.
