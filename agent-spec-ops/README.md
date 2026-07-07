# Agent Spec Ops

Compact delivery harness for agent-led product work.

The harness keeps one source of truth in `runs/<DELIVERY_ID>/workflow-state.json`.
Agents should follow the state machine, not jump from a human prompt straight
into code.

Evaluation requests are evaluate-and-fix by default. When a run/session review
finds a confirmed harness or project-instruction root cause, apply the safe fix
before reporting. Stop at analysis only when the user says "evaluate only" or a
fix needs approval or unclear product-scope changes.

Linear status checks use the harness audit, not ad hoc agent queries:

```bash
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --audit
```

The audit queries each recorded Linear issue id directly and reports non-terminal
tasks, stale links, missing ids, and status mismatches.

## Flow

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

![Agent Spec Ops compact state machine with human gates and task merge lanes](docs/state-machine.svg)

## Human Gates

- `product_review`: if not passed, go back to `knowledge_discovery`.
- `system_rules_review`: if not passed, go back to `design_assembly`.
- `implementation_review`: if not passed, go back to `implementation_in_progress`.
- If the user requests rework, go back to `task_breakdown`.

## Task Breakdown

`task_breakdown` creates Linear tasks. Each task must include:

- title
- description
- lane: `frontend` or `backend`
- role: dev or test
- scope
- dependencies
- definition of done
- verification/test plan
- expected MR description

No Linear task, no implementation.

Record task entries through the harness, then sync Linear:

```bash
node scripts/record-task-breakdown.js runs/<DELIVERY_ID>/workflow-state.json --file runs/<DELIVERY_ID>/task-breakdown.json --dependencies-checked
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create
```

Do not create temporary scripts or edit `workflow-state.json` directly to
mutate `task_graph.tasks`.

## Implementation

Frontend and backend may run in parallel. Dev and test are separate agents:

```text
frontend_dev -> frontend_test(record-test-results) -> submit-task(push/MR/comment/checks/merge)
backend_dev  -> backend_test(record-test-results)  -> submit-task(push/MR/comment/checks/merge)
```

If test fails, return to dev. If a dev/test loop reaches 3 attempts, stop and
ask the user to intervene.

Default build/general sessions and orchestrator must not start dev servers,
background daemons, Cypress, Playwright, or full test suites. Test agents must
use bounded task-scoped commands; on timeout, hang, or first failing run, record
failed evidence and return to dev instead of rerunning full suites.
Local browser E2E must be visible/headed by default so the user can watch. Use
headless only in CI, when the user explicitly asks, or for a final artifact-only
check; if visible mode is unavailable, stop and report it.

Hard gates are enforced by scripts:

- `read-context.js`, `read-instructions.js`, and `validate-state.js` fail if the run state was edited outside trusted harness writers.
- Orchestrator cannot write project files or run dev/test directly.
- Project writes require `check-write-scope.js` with the matching active role.
- Task transitions require a recorded spawn lease from `record-agent-spawn.js` with the exact `agent-spec-*` OpenCode agent name.
- `implemented` requires scoped changed files and implementation evidence.
- Test results require the task to be `testing` and a matching test-agent lease.
- `verified` requires changed files, test evidence, branch, push, MR URL, passed MR status comment URL, passed MR check evidence, and merged MR evidence.
- `submit-task.js` refuses to complete a merge unless code-host MR checks are passed; raw `gh pr merge` is not a valid harness path.
- `record-test-results.js` records tests and MR status comments only; dev-task MR check/merge evidence must come from `submit-task.js`.
- `submit-task.js` refuses unrelated dirty files instead of staging the whole worktree.
- `seal-state.js` is trusted manual repair only. It refuses to seal if `validate-state.js` still reports workflow errors.

## Commands

```bash
node scripts/new-delivery.js FTR-123 "Delivery title"
node scripts/read-context.js runs/FTR-123/workflow-state.json --role orchestrator
node scripts/read-instructions.js runs/FTR-123/workflow-state.json --role orchestrator
node scripts/plan-agent-dispatch.js runs/FTR-123/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/FTR-123/workflow-state.json <SPAWN_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>
node scripts/check-write-scope.js runs/FTR-123/workflow-state.json <TARGET_PATH> frontend_dev
node scripts/transition.js runs/FTR-123/workflow-state.json product_review "Requirements ready"
node scripts/record-task-breakdown.js runs/FTR-123/workflow-state.json --file runs/FTR-123/task-breakdown.json --dependencies-checked
node scripts/transition-task.js runs/FTR-123/workflow-state.json FE-001 active "Starting"
node scripts/record-test-results.js runs/FTR-123/workflow-state.json --task FE-001 --status passed --role frontend_test --command "npm test" --output "..." --mr-comment-url "<URL>"
node scripts/submit-task.js runs/FTR-123/workflow-state.json FE-001 --commit-msg "feat: FE-001: summary" --test-command "npm test"
node scripts/reopen-delivery.js runs/FTR-123/workflow-state.json "Human requested rework"
node scripts/validate-harness.js
```

Trusted manual repair only:

```bash
node scripts/seal-state.js runs/FTR-123/workflow-state.json "manual repair reason"
```

Generate project instructions and OpenCode agents:

```bash
node scripts/generate-project-agents.js runs/FTR-123/workflow-state.json --project-repo ../my-project --role orchestrator
```

This updates the project `AGENTS.md` and writes `.opencode/agents/agent-spec-orchestrator.md`,
frontend/backend dev/test agents, `agent-spec-pr-reviewer.md`, and
`.opencode/commands/agent-spec-spawn.md`.

Run monitor:

```bash
npm run monitor
```

Open `http://127.0.0.1:8787`.
