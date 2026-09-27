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

The component does not make external side effects exactly once. It does guarantee:

- at most one current lease for an activity;
- monotonically increasing attempt numbers;
- fencing of stale attempts with an unguessable attempt token;
- idempotent acknowledgement of a terminal result that Convex already committed;
- durable retry decisions and deadlines in Convex;
- atomic persistence of a terminal result and invocation of the application's
  completion mutation.

Handlers must make external side effects idempotent. Artifact registration and
garbage collection limit artifact lifetime, but they do not change this
execution guarantee.

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

Protocol v2 claims return an `attemptToken` plus attempt and deadline metadata.
Workers use that token for lease renewal, artifact uploads, source reads, and
terminal requests. Every write checks the deadlines immediately; it does not
wait for the watchdog. The watchdog retries or fails abandoned attempts.

Terminal receipts belong to an attempt and remain available after a retry.
Repeating the same result returns the original decision. A different result is
rejected. Completion also validates the output schema and every artifact's
activity, attempt, and slot ownership.

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

Scheduling stores a completion mutation supplied by application code. The
component's terminal mutation validates the attempt, records the result, and
invokes that mutation in one Convex transaction. The application completion
mutation then sends the corresponding Workflow event.

This boundary prevents an activity from becoming complete while its workflow
remains blocked. Repeating the same terminal request is a successful no-op;
stale attempts and conflicting results are rejected.

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

`ManagedWorkflowManager` creates one scope per workflow run. When application
code publishes a domain reference, it must call `activities.publishArtifacts`
in the same mutation with the workflow ID, owner ID, and output slots. Adoption
checks that the artifact was produced successfully, still exists in storage,
belongs to the scope, and has the expected owner. Declaring an artifact as
`retained` allows publication; it does not publish the artifact automatically.

Successful, failed, canceled, and expired scopes all delete only unadopted
artifacts. Published outputs survive partial workflow failure. Deletion requires
the owner's ID. Scope settlement also fences all remaining activities and
retries durably if the completion mutation fails.

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

Define the workflow with the configured managed manager. Its handler receives
the workflow arguments and a typed `step.steps` object:

```ts
export const exampleWorkflow = managedWorkflow
  .define({
    args: { sourceUrl: v.string() },
    steps: {
      prepare: activityStep(exampleActivities.prepare),
      publish: activityStep(exampleActivities.publish, {
        input: internal.example.activityInputs.publish,
      }),
      notify: workflowStep({
        mutation: internal.example.notifySubscribers,
        inline: true,
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

Each step has a stable key. The key sets the default display order, and its
human-readable form sets the default label. Both can be overridden. Activity
input and output types come from `defineActivity`.

`defineActivityInput` is an application helper built on a generated
`internalQuery`. It adds `workflowId` and the activity's output validator, so
callers cannot omit the workflow ID or use the wrong validator. With an input
builder, `activityStep.run` accepts the builder's domain arguments, adds the
workflow ID, runs the query, validates its result, and schedules the activity.
It then waits for validated worker output and reports worker heartbeat progress.

`workflowStep.run` executes one registered query, mutation, action, or child
workflow as one durable workflow operation. Call `step.steps.name.skip()` for
a branch that is not taken; steps the handler never reaches are finalized
automatically. Put the operation target, run options, label, and order in the
same `workflowStep` object. For example:
`workflowStep({ action, retry, label, order })`.

Activity and workflow steps can run in parallel. The coordinator prepares and
finishes them in key order while their executions run concurrently:

```ts
const results = await step.parallel({
  prepare: step.steps.prepare.run({ sourceUrl }),
  notify: step.steps.notify.run({}),
});
```

The component stores step labels and order. The workflow journal and live
activity state store execution progress. Call
`managedWorkflow.getProgress(ctx, workflowId)` to get the steps in order, with
their pending, queued, running, completed, failed, canceled, or skipped state,
timing, and progress. Domain tables no longer need activity-ID arrays, timing
arrays, completion callbacks, or label maps.

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
`context.upload_artifact`. Declare each output disposition, then explicitly adopt
retained artifacts in the mutation that publishes their domain references.
Retry, orphan, failure, cancellation, and scope cleanup are infrastructure behavior.

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

Worker contracts are generated from the application activity registry.
TypeScript gets compile-time input/output inference. Python gets generated
Pydantic models and runtime validation. This keeps the JSON contract aligned
without pretending that the TypeScript compiler can type-check Python code.

Run `bun run generate:activities` after changing a wire schema. Generated
Python models and the JSON contract snapshot are committed so contract changes
are reviewable.

## Media integration

The media workflows declare their activities and custom steps with
`managedWorkflow.define`. They run activities with
`step.steps.name.run(input)` and persist business results in explicit domain
mutations. The room UI combines core and enrichment progress. The older media
activity/timing projection is retained only as a fallback for jobs created
before managed-step registration.

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

## Breaking upgrade

Use an online, versioned rollout for populated deployments. Preserve the old
workflow graph and handlers under stable v1 function references, add the new
graph under separate v2 references, and run compatible v1 and v2 workers at the
same time. Route new submissions to v2 while existing v1 workflows drain on
their original graph. Workers must claim only protocol versions they understand;
separate task queues are preferred.

Do not replace v1 workflow exports in place, cancel healthy v1 runs as the
normal migration path, or edit Workflow component journals. Remove v1 code and
workers only after fresh verification proves that no v1 workflow, activity,
lease, retry, or terminal delivery remains.

Reprocessing now creates a new `mediaJobs` row and a new asset revision. The
previous published revision remains available for playback.

First deploy a compatibility schema and readers that handle both shapes. New
v2 writes must use the target shape before the batched migration starts.
Migrate terminal v1 rows online, reconstruct artifact owners from live asset
and lyric references, and validate ready records. Do not infer ownership from
a successful activity alone; its output may never have been published.

After v1 drains, run two clean verification passes separated by the maximum v1
lease, retry, and delivery interval, then deploy the strict schema. Keep
destructive cleanup separate and delayed through a rollback window. See
[`../../MIGRATION_FLOW_HANDOFF.md`](../../MIGRATION_FLOW_HANDOFF.md) for the
complete migration and Coolify operator handoff.
