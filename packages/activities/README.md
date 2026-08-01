# Convex Activities

This local Convex component provides durable execution of external TypeScript
and Python work while keeping Convex Workflow as the sole workflow authority.
It is application infrastructure, not a package intended for publication.

## Boundary

Convex Workflow owns orchestration: ordering, branching, joining, and durable
workflow history. This component owns the lifecycle of one external activity:
queueing, claiming, leases, attempts, retries, timeouts, cancellation, and the
terminal result.

Application code owns authentication, authorization, domain records, durable
artifact adoption, and user-facing projections. The component owns physical
storage for activity-produced artifacts, upload registration, artifact scopes,
and garbage collection. Worker runtimes own process execution, local
concurrency, temporary files, and automatic lease renewal.

```text
Convex Workflow
      |
      v
ActivityManager ----> Activities component
                           ^
                           |
                    authenticated HTTP API
                           |
                           v
                 TypeScript/Python workers
```

The component stores JSON-compatible input and output values as opaque data,
except for artifact fields declared with `wire.artifact(disposition)`. Those
fields are opaque, component-owned artifact references. Typed application
definitions validate values on both sides of the component boundary. Activity,
artifact, and application document IDs are represented as strings at component
and worker boundaries.

## Execution guarantee

Activities execute **at least once**. A worker can finish an external side
effect and disappear before Convex commits its result. Activity handlers must
therefore be idempotent. Managed artifact scopes collect registered outputs
from every attempt, and a component-owned storage sweep reclaims uploads that
complete before registration.

The component never claims exactly-once execution. Instead it guarantees:

- at most one current lease for an activity;
- monotonically increasing attempt numbers;
- fencing of stale attempts with an unguessable lease token;
- idempotent acknowledgement of a previously committed terminal result;
- durable retry decisions and deadlines in Convex;
- atomic persistence of a terminal result and invocation of the application's
  completion mutation.

It does not claim exactly-once external side effects. Artifact registration and
garbage collection bound their lifetime instead of changing the execution
guarantee.

## Queues and activities

A queue is a routing and capacity domain such as `media`, `stems`, or `lyrics`.
An activity is a versioned, typed operation assigned to a queue. One worker may
register several activities from the same queue.

Queue and activity definitions live in a static application registry. The
component persists the definition name, version, and configuration needed to
execute a scheduled activity. Workers advertise the activity versions they
support when claiming work, preventing an incompatible deployment from
claiming an older payload.

## Lifecycle

```text
scheduled
    | claim
    v
running
    |-- complete ------------------------> completed
    |-- non-retryable failure ----------> failed
    |-- retryable failure --+
    |-- expired lease -------+----------> scheduled (next attempt)
    |-- retry exhaustion ----------------> failed
    `-- cancellation --------------------> canceled
```

Workers pull only when they have a free local execution slot. Accepted work is
never buffered solely in worker memory.

Each claim receives an `attempt`, `leaseToken`, and `leaseExpiresAt`. Every
renewal and terminal request must present the current attempt and token. A
watchdog scheduled mutation checks the lease deadline. A renewed lease causes
the watchdog to reschedule itself; an expired lease is retried or failed.

## Timeouts and retries

The initial API supports a focused subset of Temporal-style activity options:

- `startToCloseTimeoutMs`: maximum wall time for one attempt;
- `scheduleToCloseTimeoutMs`: maximum wall time including queueing and retries;
- `retryPolicy.maximumAttempts`;
- `retryPolicy.initialIntervalMs`;
- `retryPolicy.backoffCoefficient`;
- `retryPolicy.maximumIntervalMs`;
- `retryPolicy.nonRetryableErrorTypes`.

Lease renewal is automatic worker liveness, independent of user-facing
progress. Progress and checkpoint details are optional and are not part of the
workflow history.

Automatic renewal depends on the worker runtime remaining schedulable. Activity
handlers must not run CPU-heavy or GIL-holding work on the lease-owning event
loop. TypeScript handlers use `context.runProcess`; Python handlers use
`context.run_process`. The parent owns leases and cancellation while the child
owns heavy computation. The runtime packages document this execution contract
and test a managed child that runs longer than one lease.

## Completion and workflow wake-up

Scheduling stores a completion mutation handle supplied by application code.
The component's terminal mutation validates the lease, records the result, and
invokes that handle in one Convex transaction. The application completion
mutation sends the corresponding Workflow event.

This atomic boundary prevents an activity from being marked complete while its
workflow remains permanently blocked. Repeating the same terminal request is a
successful no-op; a stale attempt or conflicting result is rejected.

Terminal activity records are retained for seven days after successful
completion delivery, then removed by a component-owned scheduled mutation.
Pending completion delivery is never deleted.

## Managed artifacts

Artifact-producing output fields are declared once in the wire schema:

```ts
output: wire.object({
  source: wire.artifact("intermediate"),
  final: wire.artifact("retained"),
});
```

That declaration drives generated contracts, worker upload-slot validation,
and branded TypeScript output types. Artifact-producing activities are
scheduled inside a managed workflow; its private scope is resolved
automatically. Workers upload through
`context.uploadArtifact` / `context.upload_artifact`; unrestricted worker upload
URLs are not exposed.

`ManagedWorkflowManager` binds the scope lifecycle to Convex Workflow. Starting
a managed workflow creates a scope and binds it to the workflow ID without
exposing the scope to application code. Successful completion keeps every
`retained` artifact produced by an activity's final successful attempt and
deletes every other artifact in bounded batches. Failure or cancellation
deletes all artifacts in the scope. Settlement retries durably if its
completion mutation fails.

Scopes also expire independently, and an hourly component sweep removes old
component-storage objects that were uploaded but never registered.

## Registering a managed workflow

Define each external activity with wire schemas. Artifact lifecycle is part of
the output contract, so there is no separate cleanup registration:

```ts
export const exampleActivities = {
  prepare: defineActivity({
    name: "example.prepare",
    version: 1,
    queue,
    input: wire.object({ sourceUrl: wire.string }),
    output: wire.object({
      normalized: wire.artifact("intermediate"),
    }),
    startToCloseTimeoutMs: 10 * 60_000,
    scheduleToCloseTimeoutMs: 60 * 60_000,
  }),
  publish: defineActivity({
    name: "example.publish",
    version: 1,
    queue,
    input: wire.object({ normalizedUrl: wire.string }),
    output: wire.object({
      final: wire.artifact("retained"),
    }),
    startToCloseTimeoutMs: 10 * 60_000,
    scheduleToCloseTimeoutMs: 60 * 60_000,
  }),
};
```

When an activity needs worker-facing values derived from domain state, define a
typed, read-only input builder. It must accept `workflowId`; the managed runtime
injects that value automatically:

```ts
export const publish = defineActivityInput({
  activity: exampleActivities.publish,
  args: { normalized: v.string() },
  handler: async (ctx, { normalized }) => ({
    normalizedUrl: await artifactUrl(ctx, normalized),
  }),
});
```

Define the workflow through the configured managed manager. The handler
receives its declared application arguments and typed, workflow-bound steps:

```ts
const notifySubscribers = mutationOptions({
  mutation: internal.example.notifySubscribers,
  inline: true,
});

export const exampleWorkflow = managedWorkflow
  .define({
    args: { sourceUrl: v.string() },
    steps: {
      prepare: activityStep(exampleActivities.prepare),
      publish: activityStep(exampleActivities.publish, {
        input: internal.example.activityInputs.publish,
      }),
      notify: workflowStep(notifySubscribers, {
        label: "Notify subscribers",
      }),
    },
  })
  .handler(async (step, { sourceUrl }) => {
    const prepared = await step.steps.prepare.run({
      sourceUrl,
    });

    await step.steps.publish.run({
      normalized: prepared.normalized,
    });

    await step.steps.notify.run({});
  });
```

The key is the stable consumer-facing step identity and its declaration order
is the default display order. Labels default to a humanized key and can be
overridden. Activity input and output types are inferred from `defineActivity`.
`defineActivityInput` is an app-level helper built on that app's generated
`internalQuery`; it adds `workflowId` and the activity's return validator so
those invariants cannot be wired incorrectly at each call site.
When an input builder is present, `activityStep.run` accepts the builder's
domain arguments, injects `workflowId`, runs the query, and schedules its
validated return value. It then links the activity to the workflow, waits for
its validated output, and exposes worker heartbeat progress. `workflowStep.run`
executes one registered query, mutation, action, or child workflow as a
structured journal boundary. Conditional steps may be marked early with
`step.steps.name.skip()`; unreached steps are finalized automatically.
Use `queryOptions`, `mutationOptions`, `actionOptions`, or `workflowOptions` to
construct reusable execution policy separately from each workflow's label and
display order.

Structured activity and workflow steps can run safely in parallel. The
coordinator starts, executes, and finishes each phase in stable key order:

```ts
const results = await step.parallel({
  prepare: step.steps.prepare.run({ sourceUrl }),
  notify: step.steps.notify.run({}),
});
```

Use `manualWorkflowStep()` only for a small parent-specific sequence that would
not benefit from its own registered child workflow:

```ts
steps: {
  refreshCache: manualWorkflowStep({ label: "Refresh cache" }),
}

await step.steps.refreshCache.run(async () => {
  const keys = await step.runQuery(internal.example.listCacheKeys, {});
  await step.runMutation(internal.example.refreshCache, { keys });
});
```

The manual `run(callback)` call must be awaited immediately. Starting another
managed step while it is active throws with guidance before the workflow can
append a nondeterministic journal sequence.

The component persists the complete progress projection. Consumers call
`managedWorkflow.getProgress(ctx, workflowId)` and receive ordered pending,
queued, running, completed, failed, canceled, or skipped steps with timing and
activity progress. Domain tables do not need their own activity-ID arrays,
timing arrays, completion callbacks, or label maps.

Start it through `managedWorkflow.start`, not the underlying
`WorkflowManager.start`. The manager creates the scope and installs the
universal terminal callback:

```ts
const workflowId = await managedWorkflow.start(
  ctx,
  internal.example.pipeline.exampleWorkflow,
  { sourceUrl },
  {
    onComplete: internal.example.pipeline.onComplete,
    context: { jobId },
  },
);
```

Worker handlers upload only declared slots through `context.uploadArtifact` or
`context.upload_artifact`. A workflow author therefore makes one artifact
decision: its disposition in the activity output. Retry, orphan, failure,
cancellation, and terminal cleanup are infrastructure behavior.

## Cancellation

Cancellation is cooperative. Convex marks a running activity as cancellation
requested. Lease renewal returns that state to the worker, whose runtime stops
the handler or subprocess and acknowledges cancellation. If the worker is
unreachable, the lease watchdog reaches the terminal canceled state.

## Packages

The implementation is split by runtime responsibility:

```text
packages/activities
    local Convex component and this design contract

packages/activity-worker
    shared JSON wire protocol and TypeScript worker runtime

packages/activity-worker-python
    Python worker runtime

packages/media-activities
    media queues, typed activity registry, and generated wire contracts
```

The Python package is a workspace source package consumed by the Python apps;
it is not intended for PyPI publication.

## Definition and protocol versioning

Every scheduled activity records an activity name, activity version, and wire
protocol version. Existing versions must remain registered until their queued
and running work has drained. Breaking input or output changes require a new
activity version.

Compatibility has three deliberately separate rules:

- Changing only workflow ordering, branching, or joining requires no version
  change. Convex Workflow owns that durable orchestration.
- Changing an activity's input, output, artifacts, or observable worker behavior
  requires incrementing that activity's `version`.
- Changing the shared claim, lease, cancellation, progress, or artifact HTTP
  protocol incompatibly requires incrementing `protocolVersion`.

Workers include `protocolVersion` in every claim request. The backend rejects a
claim before leasing work when that version differs, so an old worker cannot
fail an activity merely because a rolling deployment changed the transport.
The `defineActivity` and managed workflow APIs repeat these rules in their
editor documentation so the decision is visible at callsites.

The worker activity contracts are generated from the application activity registry.
TypeScript receives compile-time input/output inference. Python receives
generated Pydantic models plus runtime validation. This provides wire
compatibility without pretending that the TypeScript compiler can type-check
Python source.

Run `bun run generate:activities` after changing a wire schema. Generated
Python models and the JSON contract snapshot are committed so contract changes
are reviewable.

## Media integration

The media workflows declare consumer-visible activity and custom steps through
`managedWorkflow.define`. They execute activities through
`step.steps.name.run(input)` and keep business-result persistence as explicit
domain mutations. Core and enrichment progress snapshots are combined for the
room UI. The older media activity/timing projection remains only as a fallback
for jobs created before managed step registration.

Workers authenticate to `/activities/workers/*` with
`ACTIVITY_WORKER_TOKEN`. The media source URL remains encrypted in the
application database and is returned only from the authenticated worker API;
it is not copied into activity payloads or component storage. Workers use the
same API to upload declared artifacts into component-owned Convex storage.

## Required failure tests

The component and runtimes test the durable state transitions, wire contracts,
claim races, fencing, lease renewal, retry limits, cancellation, and duplicate
terminal requests. End-to-end infrastructure tests should additionally cover:

- a worker dies before or during execution;
- an old attempt completes after a new attempt starts;
- completion commits but the HTTP response is lost;
- schedule-to-close expires while queued or retrying;
- worker output fails application-level validation;
- an artifact upload succeeds but registration or activity completion does not;
- a workflow succeeds, fails, or is canceled with staged artifacts;
- terminal completion delivery remains pending past the retention deadline.

## Deliberate omissions

This component does not implement workflow replay, signals, queries, child
workflows, continue-as-new, search attributes, local activities, or exactly-once
side effects. Convex Workflow already provides workflow durability; duplicating
those features would create two competing orchestration authorities.
