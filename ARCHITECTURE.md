# Workers and activities

CPU/GPU processing runs through the shared activity system, including small models
and optional fallbacks. Simple network requests, such as searching LRCLIB, can
remain Convex actions without a separate worker.

An **activity** is one named task with defined inputs and outputs. A **worker**
picks up queued activities and runs them. A **workflow** decides what to run next
and saves progress so completed steps survive restarts.

## Who is responsible for what

- **Convex Workflow** owns ordering, parallel steps, and fallback decisions.
- **The activities component** stores queued work, tracks attempts, and handles
  leases, retries, timeouts, cancellation, and saved results.
- **Shared worker libraries** pick up work when a local slot is free, renew leases,
  validate inputs/outputs, manage child processes, and deliver results.
- **Application code** checks permissions, updates records, publishes output files,
  and shows progress to users.

Use these existing boundaries rather than building another job endpoint, in-memory
queue, busy flag, or retry loop. A private model server can sit behind an activity
handler; it does not replace the activity system. Reuse a worker unless different
hardware, runtime, or process isolation calls for a separate one.

## Work must stop safely and be safe to repeat

A **lease** is an attempt's temporary permission to work. The worker library
renews it automatically; progress updates are for users, not lease renewal.
Cancellation, shutdown, or loss of the lease stops the actual work, including
child processes or remote inference, not just the caller waiting for its result.
Waiting for a model or hardware lock must also remain cancelable and time-limited.

Do not block the event loop that renews leases. Use the shared managed-process
helpers for blocking/native work. Persistent model processes need the same cleanup
guarantees: stop them, wait for exit, force-stop when necessary, and reset after
failure. A model lock can protect a non-thread-safe process, but is not a job queue.

An activity can execute more than once, including after work finished but before
its result was saved. Repeating it must not duplicate charges or damage data.
Use the current attempt token and shared result API so stale attempts cannot
overwrite newer results. Let the library retry result delivery rather than rerun
finished work because a response was lost.

Distinguish valid negative results from failures. Unsupported input should not
retry indefinitely; temporary failures follow the activity's bounded retry policy.
The workflow decides whether an optional failure blocks the main job.

## Files and private data have clear owners

Each attempt uses its own temporary directory and cleans up on every exit path.
Cleanup cannot delete another live process's files or escape through symlinks.
Keep model caches separate, serialize shared cache updates, and verify downloads
before loading them. Bound file sizes, network waits, logs, and inference memory.

Validate untrusted external URLs separately from trusted internal artifact URLs.
Keep credentials and private source URLs out of activity payloads and logs; retrieve
protected source information through the authenticated, attempt-scoped worker API.

Return small values directly. Files use declared artifact slots and shared upload
helpers, not local paths or permanent download URLs. Marking a file `retained`
only permits the application to keep it: the mutation saving its record must
also call `activities.publishArtifacts` with the correct owner and workflow.
Preserve files needed by later workflows; the component cleans up unpublished
outputs without deleting published files after an unrelated failure.

## Hardware and readiness are explicit

Queue concurrency and container limits do not coordinate every worker sharing a
GPU. All model processes, including startup and persistent ones, participate in
the deployment's shared hardware controls. Loaded models consume memory while
idle; keeping one warm must not prevent another worker from using the hardware.

Explicit GPU modes run real inference on the requested backend and fail clearly
instead of silently switching to CPU. Health responses include shared worker health
and relevant model/device state; an open HTTP port alone does not prove readiness.
Mocked tests do not prove GPU use or sufficient memory for simultaneous workloads.

## Contracts and running jobs survive upgrades

The activity registry defines inputs, outputs, time limits, retry rules, and output
files. Incompatible task changes increase the activity version; incompatible
worker API changes increase `protocolVersion`. Changing workflow order alone does
not require an activity version bump. Generated contracts come from the registry.

Breaking upgrades keep compatible old/new workflows and workers side by side,
routing new jobs to the new version while old jobs finish. Do not replace functions
still referenced by running jobs, cancel healthy jobs to migrate them, or edit saved
workflow history. Data migrations first support both record shapes and preserve
published file ownership. Remove old code only after repeated checks find no old
jobs, leases, retries, or pending result deliveries; defer destructive cleanup
through the rollback window.

Practical implementation and validation guidance lives in the repository's
[activity-development skill](.agents/skills/activity-development/SKILL.md).
