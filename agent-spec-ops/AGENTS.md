# Agent Spec Ops Instructions

Use this harness to manage delivery state. Do not treat a human prompt as a
direct coding command while a run is active.

Evaluation is not passive. If the user asks to evaluate, inspect, review, or
diagnose a run/session, also apply safe harness/project instruction fixes for
confirmed root causes before reporting. Only stop at evaluation when the user
explicitly says "evaluate only" or the fix needs approval or would touch
unclear product scope.

Default/freeform OpenCode `build` or `general` sessions are not harness
orchestrators. If a prompt was not launched through `/agent-spec-spawn` or
`@agent-spec-orchestrator`, stop and ask the user to restart through the
harness command/agent before planning, spawning, editing, submitting, or
merging.

For Linear status disputes, session evaluation, or "is this still backlog/in
progress/done?" checks, run `node scripts/sync-linear-task.js
runs/<DELIVERY_ID>/workflow-state.json --audit` and trust that issue-by-issue
report. Do not hand-roll Linear GraphQL filters in agent chat; they miss
paginated issues, stale ids, project filters, and active tasks.

## Required Start

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
```

Use transition scripts. Do not edit `workflow-state.json` status fields by hand.
Real run state is sealed by trusted harness writers. If context recovery or
state validation reports an integrity failure, stop and repair before
continuing.

## Compact Flow

```text
intake
-> tool_readiness
-> knowledge_discovery
-> product_requirements
-> product_review
-> design_assembly
-> system_rules
-> system_rules_review
-> task_breakdown
-> implementation_in_progress
-> implementation_review
-> done
```

## Human Gates

- `product_review`: pass -> `design_assembly`; fail -> `knowledge_discovery`.
- `system_rules_review`: pass -> `task_breakdown`; fail -> `design_assembly`.
- `implementation_review`: pass -> `done`; fail -> `implementation_in_progress`.
- User asks for rework: `task_breakdown`.

## Task Breakdown

Create Linear tasks only. Each task needs description, lane, role, scope,
dependencies, definition of done, verification/test plan, and MR description.
Record new task entries with `record-task-breakdown.js`; do not write temporary
scripts or edit `workflow-state.json` directly to mutate `task_graph.tasks`.
After recording tasks, run `sync-linear-task.js --create`.

## Implementation

Frontend and backend can run in parallel. Dev and test are separate agents:

```text
frontend_dev -> frontend_test(record-test-results) -> submit-task(push/MR/comment/checks/merge)
backend_dev  -> backend_test(record-test-results)  -> submit-task(push/MR/comment/checks/merge)
```

If test fails, return to dev. If the dev/test loop reaches 3 attempts, stop and
tell the user what failed.

Default build/general sessions and orchestrator must not start dev servers,
background daemons, Cypress, Playwright, or full test suites. Test agents must
use bounded task-scoped commands; on timeout, hang, or first failing run, record
failed evidence and return to dev instead of rerunning full suites.
Local browser E2E must be visible/headed by default so the user can watch. Use
headless only in CI, when the user explicitly asks, or for a final artifact-only
check; if visible mode is unavailable, stop and report it.

Hard gates:

- Orchestrator cannot write project files or run dev/test directly.
- Project writes require `check-write-scope.js` with the matching active role.
- Task transitions require a recorded spawn lease from `record-agent-spawn.js` with the exact `agent-spec-*` OpenCode agent name.
- `implemented` requires scoped changed files and implementation evidence.
- Test results require `testing` status and a matching test-agent lease.
- `verified` requires changed files, tests, branch, push, MR URL, passed MR status comment URL, passed MR check evidence, and merged MR evidence.
- Do not run raw `gh pr merge`; use `submit-task.js` so checks are inspected before merge.
- `record-test-results.js` records tests and MR status comments only; dev-task MR check/merge evidence must come from `submit-task.js`.
- `submit-task.js` refuses unrelated dirty files.
- `seal-state.js` is trusted manual repair only. It refuses invalid workflow data and must not be used as normal recovery.

## Commands

```bash
node scripts/transition.js runs/<DELIVERY_ID>/workflow-state.json <NEXT_STATE> "reason"
node scripts/record-task-breakdown.js runs/<DELIVERY_ID>/workflow-state.json --file runs/<DELIVERY_ID>/task-breakdown.json --dependencies-checked
node scripts/transition-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> <STATUS> "reason"
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <REQUEST_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>
node scripts/check-write-scope.js runs/<DELIVERY_ID>/workflow-state.json <TARGET_PATH> <ROLE>
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --audit
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json --task <TASK_ID> --status passed --role <TEST_ROLE> --command "<COMMAND>" --output "..." --mr-comment-url "<URL>"
node scripts/submit-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> --commit-msg "feat: <TASK_ID>: summary" --test-command "<OPTIONAL_RECHECK_COMMAND>"
node scripts/reopen-delivery.js runs/<DELIVERY_ID>/workflow-state.json "reason"
```
