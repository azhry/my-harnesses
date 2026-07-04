# Agent Spec Ops

Compact delivery harness for agent-led product work.

The harness keeps one source of truth in `runs/<DELIVERY_ID>/workflow-state.json`.
Agents should follow the state machine, not jump from a human prompt straight
into code.

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

## Implementation

Frontend and backend may run in parallel. Dev and test are separate agents:

```text
frontend_dev -> frontend_test -> push -> MR -> MR comment passed/failed -> merge
backend_dev  -> backend_test  -> push -> MR -> MR comment passed/failed -> merge
```

If test fails, return to dev. If a dev/test loop reaches 3 attempts, stop and
ask the user to intervene.

Hard gates are enforced by scripts:

- Orchestrator cannot write project files or run dev/test directly.
- Project writes require `check-write-scope.js` with the matching active role.
- Task transitions require a recorded spawn lease from `record-agent-spawn.js`.
- Test results require the task to be `testing` and a matching test-agent lease.
- `verified` requires changed files, test evidence, branch, push, MR URL, passed MR status comment URL, and merged MR evidence.
- `submit-task.js` refuses unrelated dirty files instead of staging the whole worktree.

## Commands

```bash
node scripts/new-delivery.js FTR-123 "Delivery title"
node scripts/read-context.js runs/FTR-123/workflow-state.json --role orchestrator
node scripts/read-instructions.js runs/FTR-123/workflow-state.json --role orchestrator
node scripts/plan-agent-dispatch.js runs/FTR-123/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/FTR-123/workflow-state.json <SPAWN_ID> <AGENT_ID>
node scripts/check-write-scope.js runs/FTR-123/workflow-state.json <TARGET_PATH> frontend_dev
node scripts/transition.js runs/FTR-123/workflow-state.json product_review "Requirements ready"
node scripts/transition-task.js runs/FTR-123/workflow-state.json FE-001 active "Starting"
node scripts/record-test-results.js runs/FTR-123/workflow-state.json --task FE-001 --status passed --role frontend_test --command "npm test" --output "..." --mr-comment-url "<URL>" --merged --merge-commit "<SHA>"
node scripts/reopen-delivery.js runs/FTR-123/workflow-state.json "Human requested rework"
node scripts/validate-harness.js
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
