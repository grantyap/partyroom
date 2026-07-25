# Partyroom Python activity worker

The worker owns activity claims, automatic lease renewal, cancellation, input/output
validation, and terminal delivery. Handlers own application work.

## Execution contract

- Handlers must remain asynchronous and must not block the `asyncio` event loop.
- Use `await context.run_process(...)` for CPU-heavy work, native inference, and
  external tools. `asyncio.to_thread` is appropriate only for brief I/O or code
  known to release the GIL.
- Managed child processes are terminated when an activity is canceled, its lease
  is lost, or the worker stops.
- Use `await context.upload_artifact(slot, path, content_type)` for declared
  durable outputs. It uploads and registers the object against the current
  fenced attempt and returns an opaque artifact reference.
- `heartbeat` and `report_progress` publish details immediately, but callers do not
  need to invoke them solely to keep a lease alive; renewal is automatic while the
  event loop remains schedulable.

`health()` reports the last poll, last successful renewal, and current/maximum event
loop lag. The activities service remains the durable source of truth and expires a
lease when a worker stops renewing it.
