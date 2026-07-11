# DevCircuit architecture

DevCircuit is a workflow controller with replaceable agents inside it. It is not one long agent prompt.

## Authority boundaries

- Sealed workflow JSON: canonical workflow state and append-only events.
- Linear: project/specification/task planning and the visible four-status task projection.
- GitHub: branches, pull requests, required checks, review objects, and merges.
- Evidence files: commands, outputs, exit status, artifacts, producer, timestamp, and exact SHA.

## Task lifecycle

```text
planned / Linear Todo
  -> implementing / Linear In Progress
  -> in_review / Linear In Review
      -> failed: implementing / Linear In Progress
      -> passed: review_passed / Linear Done
  -> merge_ready / Linear Done
  -> merged / Linear Done
  -> post_merge_verified / Linear Done
```

The Linear task becomes Done when independent review passes, as required. Project completion remains stricter: every task must be post-merge verified.

## Roles

- Implementer: writes one task branch and records implementation/test evidence.
- Reviewer: checks the exact PR SHA in a fresh workspace and returns pass or fail.
- Gatekeeper: reads evidence and emits ALLOW or DENY. It cannot implement or merge.
- Merger: may merge only after current-SHA ALLOW and GitHub required checks.
- Supervisor: continuously validates invariants, heartbeats, and stale decisions.

The same external agent/session identifier cannot hold two roles for one task.

## Controller trust boundary

`DEVCIRCUIT_STATE_KEY` belongs only to the supervisor/controller process. Worker agents receive bounded context through the runtime adapter and never inherit this secret. State files use HMAC-SHA-256, monotonic revisions, atomic rename, and a controller lock. Planner, agent, and repository subprocesses must run through `DEVCIRCUIT_SANDBOX_RUNNER` in a container/VM or distinct OS principal with a minimal mount namespace, ephemeral HOME, and explicit environment allowlist.

Workers return results through random capabilities scoped to task, role, and attempt. The untrusted submitter can only write an inbox envelope. The controller validates the capability hash and scope, verifies repository facts, executes contracted commands itself in the sandbox, and owns all sealed-state mutations.

The agent runtime adapter is a trusted connector. It must return a real runtime lease containing a distinct agent ID, principal, and workspace ID. DevCircuit records the adapter executable digest with the lease. A production adapter should additionally verify the runtime provider's signed session metadata.

## Failure behavior

- Review failure returns the same task to implementation and increments its attempt.
- Any new implementation invalidates review and gate records.
- Missing or stale evidence is denied.
- A monitor integrity error is visible and cannot be converted into a pass.
- Post-merge failure keeps Linear Done (review semantics), marks the run At Risk, and requires fix-forward or revert work.
- Change requests are versioned and accepted only at a safe planning boundary; historical specifications and delivered tasks are preserved.
