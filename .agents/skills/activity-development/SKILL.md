---
name: activity-development
description: Add or change Partyroom activities, worker handlers, or their workflow integration. Use for task contracts, execution lifecycle, and worker resource handling, not unrelated UI or ordinary API changes.
---

# Activity development

Read [ARCHITECTURE.md](../../../ARCHITECTURE.md) for the shared design and constraints.
It is the source of truth; keep implementation-specific instructions beside code.

Before editing, locate the relevant activity definition, workflow caller, worker
handler, and shared runtime API. Follow an existing activity using the same runtime.
Decide whether the requested change affects a task contract, orchestration, or
worker execution; preserve the other boundaries.

Implement the smallest complete change, including affected generated contracts,
callers, progress displays, tests, and startup/deployment settings. Do not introduce
a separate execution path for optional work.

Read only the applicable parts of [implementation checks](references/implementation-checks.md):

- **Contracts and workflows:** registry/schema changes, fallback decisions, or retries.
- **Models and processes:** inference, persistent processes, GPU modes, or hardware locks.
- **Files and network access:** downloads, temporary files, or artifact-producing tasks.
- **Breaking rollouts:** incompatible contracts or stored-data changes only.
- **Verification:** select checks for the behavior actually changed.

Finish with what changed and evidence from the relevant checks. Clearly distinguish
mocked tests, live hardware checks, and anything not verified. Do not deploy or
modify production resources just to complete validation without authorization.
