# Agent Spec Ops Instructions

Use this harness to manage delivery state. Do not treat a human prompt as a
direct coding command while a run is active.

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

## Implementation

Frontend and backend can run in parallel. Dev and test are separate agents:

```text
frontend_dev -> frontend_test -> push -> MR -> MR comment -> checks pass -> merge
backend_dev  -> backend_test  -> push -> MR -> MR comment -> checks pass -> merge
```

If test fails, return to dev. If the dev/test loop reaches 3 attempts, stop and
tell the user what failed.

Hard gates:

- Orchestrator cannot write project files or run dev/test directly.
- Project writes require `check-write-scope.js` with the matching active role.
- Task transitions require a recorded spawn lease from `record-agent-spawn.js` with the exact `agent-spec-*` OpenCode agent name.
- `implemented` requires scoped changed files and implementation evidence.
- Test results require `testing` status and a matching test-agent lease.
- `verified` requires changed files, tests, branch, push, MR URL, passed MR status comment URL, passed MR check evidence, and merged MR evidence.
- Do not run raw `gh pr merge`; use `submit-task.js` so checks are inspected before merge.
- `submit-task.js` refuses unrelated dirty files.
- `seal-state.js` is trusted manual repair only. It refuses invalid workflow data and must not be used as normal recovery.

## Commands

```bash
node scripts/transition.js runs/<DELIVERY_ID>/workflow-state.json <NEXT_STATE> "reason"
node scripts/transition-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> <STATUS> "reason"
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <REQUEST_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>
node scripts/check-write-scope.js runs/<DELIVERY_ID>/workflow-state.json <TARGET_PATH> <ROLE>
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json --task <TASK_ID> --status passed --role <TEST_ROLE> --command "<COMMAND>" --output "..." --mr-comment-url "<URL>" --merge-check-evidence "<CHECKS_PASSED>" --merged --merge-commit "<SHA>"
node scripts/reopen-delivery.js runs/<DELIVERY_ID>/workflow-state.json "reason"
```
