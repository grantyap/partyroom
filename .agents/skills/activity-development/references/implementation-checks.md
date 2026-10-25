# Implementation checks

Use the sections relevant to the requested change, not this entire checklist for
every edit. Architectural requirements belong in the root architecture document.

## Contracts and workflows

- Locate definitions in the application activity registry, not generated files.
  Check queue capacity, per-attempt and total time limits, retryable error types,
  and compatibility with deployed worker versions.
- Put ordering and fallback decisions in the managed workflow using `activityStep`.
  For optional extraction, test a normal success, a genuine miss, and an upstream
  failure separately; do not treat them as the same branch.
- Use the shared TypeScript/Python worker library for registration and execution.
  An unavailable worker leaves work queued rather than rejected by a custom busy
  endpoint. A valid unknown result is not a transport or inference failure.
- After registry changes run `bun run generate:activities`. Include generated
  Python models and the JSON contract snapshot when affected. Update callers,
  workflow input builders, result mutations, and displayed progress as needed.

## Models and processes

- Use `context.runProcess` or `context.run_process` for blocking/native tasks.
  Connect asynchronous I/O to activity cancellation; verify a canceled request
  stops inference in the model server, not merely the HTTP client.
- Persistent processes need explicit startup, request serialization, failure
  recovery, and shutdown. Drain stdout/stderr with bounded storage. On cancellation
  or failure, terminate, wait, and force-stop if necessary before reuse.
- Treat the model-download lock and shared hardware lock as different concerns.
  Protect cached files from partial/concurrent downloads. Include startup and
  persistent models in shared hardware admission, including deployments using
  `ACTIVITY_PROCESS_LOCK_PATH`; release idle models/locks when sharing requires it.
- Check plain Docker, native Apple Silicon, and NVIDIA paths affected by the change.
  Keep CPU thread counts and model precision compatible with resource limits and
  hardware capabilities. Verify device use after real inference, not just discovery.
- Preserve shared worker health fields; add model diagnostics without replacing
  worker liveness. Inspect recent polling, renewal, and event-loop lag when work stalls.

## Files and network access

- Name work directories with the activity ID and attempt number; use `finally`
  cleanup. Sweep stale files only within an exclusively owned work directory,
  without following symlinks or deleting another live attempt's files.
- Check declared and streamed download sizes, output sizes, timeouts, and expected
  file formats. Write complete results atomically when another process consumes them.
- Use existing external-source validation and internal URL-origin helpers as
  appropriate. Retrieve private source information through the authenticated worker
  API using the current attempt token; do not put it into saved activity payloads.
- Declare file outputs as artifact slots and upload through the activity context.
  Publish retained outputs in the mutation saving their application references.
  Check that files passed to later workflows outlive the producing workflow.

## Breaking rollouts

For incompatible changes, preserve old workflow exports and compatible workers,
use separate queues where necessary, and route new work to the new version.
First support both stored-data shapes, then migrate records using published
references to establish file ownership. Verify old workflows, activities, leases,
retries, and pending deliveries have drained; repeat after their maximum delay
before removing old code. Keep destructive cleanup outside the rollback window.

## Verification

Select existing tests for the touched layer instead of retesting the whole
infrastructure for every handler edit. Relevant cases include:

- Invalid inputs/outputs, valid negative results, temporary and permanent failures.
- Worker death, cancellation during inference or a hardware-lock wait, lease loss,
  and late completion from an older attempt.
- Completion saved with its response lost: retry delivery without rerunning work.
- Interrupted downloads, upload success followed by registration/completion failure,
  and cleanup after partial workflow failure.
- Startup/readiness, real GPU execution, and resource use under simultaneous load
  when shared-hardware behavior changes. Report capacity checks separately from
  device detection and mocked tests.
