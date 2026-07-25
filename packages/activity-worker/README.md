# Partyroom activity worker

The worker owns activity claims, automatic lease renewal, cancellation, input/output
validation, and terminal delivery. Handlers own application work.

## Execution contract

- Handlers must remain asynchronous and must not block the JavaScript event loop.
- Use `context.runProcess(command, options)` for CPU-heavy work, native inference,
  and external tools. It keeps lease renewal in the parent process and terminates
  the child when the activity is canceled or its lease is lost.
- Long asynchronous I/O may be awaited directly.
- Observe `context.signal` in custom asynchronous loops.
- Use `context.uploadArtifact(slot, body, contentType)` for declared durable
  outputs. It uploads and registers the object against the current fenced
  attempt and returns an opaque artifact reference.
- `heartbeat` and `reportProgress` publish details immediately, but callers do not
  need to invoke them solely to keep a lease alive; renewal is automatic while the
  event loop remains schedulable.

`health()` reports the last poll, last successful renewal, and current/maximum event
loop lag. The activities service remains the durable source of truth and expires a
lease when a worker stops renewing it.
