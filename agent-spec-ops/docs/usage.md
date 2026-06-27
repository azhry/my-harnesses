# Using Agent Spec Ops

This guide explains how to install and use `agent-spec-ops` with agents such as
Codex or OpenCode.

## Recommended Layout

Put the harness beside the project repository whenever possible:

```text
workspace/
  agent-spec-ops/
  product-repo/
```

Sibling layouts also work if `workspace_root` in
`runs/<DELIVERY_ID>/workflow-state.json` points to the common workspace root.

## Prerequisites

The harness uses Node.js built-ins only.

```bash
node --version
git --version
```

Set required external-system credentials in the shell that launches the agent.
Raw keys must stay in environment variables and must not be written to state,
Linear issue bodies, knowledge cards, logs, or reports.

```bash
export LINEAR_API_KEY="lin_api_..."
export LINEAR_TEAM_ID="..."
export LINEAR_PROJECT_ID="..."   # recommended when creating issues
export GITHUB_TOKEN="ghp_..."    # or GH_TOKEN
```

PowerShell:

```powershell
$env:LINEAR_API_KEY="lin_api_..."
$env:LINEAR_TEAM_ID="..."
$env:LINEAR_PROJECT_ID="..."
$env:GITHUB_TOKEN="ghp_..."
```

## Validate The Harness

From `agent-spec-ops/`:

```bash
node scripts/validate-harness.js
```

Expected result:

```text
OK: agent-spec-ops files, scripts, template, and example are valid
```

## Create A Delivery

```bash
node scripts/new-delivery.js MY-001 "Short delivery title" --workspace /path/to/workspace
```

This creates `runs/MY-001/workflow-state.json` and the run-local memory files.

## Agent Startup Prompt

Use this prompt shape for Codex, OpenCode, or another coding agent:

```text
Use agent-spec-ops/AGENTS.md as the operating harness.

Before acting, run:
node agent-spec-ops/scripts/read-context.js agent-spec-ops/runs/MY-001/workflow-state.json --role orchestrator
node agent-spec-ops/scripts/read-instructions.js agent-spec-ops/runs/MY-001/workflow-state.json --role orchestrator

Follow transition scripts only. Do not edit workflow-state.json status fields
directly. Treat harness-policy.json as executable policy. Linear is required
for task management and promoted knowledge.
```

For a role worker, replace `orchestrator` with the active role, such as
`frontend_dev`, `backend_dev`, `project_manager`, or `frontend_test`.

## Normal Operating Loop

Always begin or resume with compact context:

```bash
node scripts/read-context.js runs/MY-001/workflow-state.json --role orchestrator
node scripts/read-instructions.js runs/MY-001/workflow-state.json --role orchestrator
```

Verify policy:

```bash
node scripts/enforce-policy.js runs/MY-001/workflow-state.json
```

Move top-level workflow state with:

```bash
node scripts/transition.js runs/MY-001/workflow-state.json <next_state> "Reason"
```

Move task state with:

```bash
node scripts/transition-task.js runs/MY-001/workflow-state.json <TASK_ID> <STATUS> "Reason"
```

## Tool Readiness

```bash
node scripts/transition.js runs/MY-001/workflow-state.json tool_readiness "Start tool readiness"
node scripts/check-tool-readiness.js runs/MY-001/workflow-state.json --product-tracker linear --code-host github
```

Then prepare/send the human tool-readiness gate instructions and transition to
`waiting_for_tool_readiness_review`.

## Task Management

Policy requires Linear as task system of record after planning begins. After the
Project Manager creates `task_graph.tasks[]`, create/sync Linear issues:

```bash
node scripts/sync-linear-task.js runs/MY-001/workflow-state.json --create
```

Do not proceed to delivery-plan approval until every task has `linear_id`.

## Knowledge Management

Record reusable knowledge locally first:

```bash
node scripts/record-knowledge.js runs/MY-001/workflow-state.json \
  --kind process_rule \
  --status promoted \
  --statement "Reusable lesson" \
  --rationale "Why future agents need this"
```

Before final review, sync promoted knowledge to Linear:

```bash
node scripts/sync-linear-knowledge.js runs/MY-001/workflow-state.json
```

## State Size Maintenance

When `workflow-state.json` gets noisy:

```bash
node scripts/compact-state.js runs/MY-001/workflow-state.json
```

This archives old history into `runs/MY-001/archives/` and writes
`runs/MY-001/workflow-summary.json`.

## Final Review Checklist

Before final review:

```bash
node scripts/check-contracts.js runs/MY-001/workflow-state.json
node scripts/check-scope.js runs/MY-001/workflow-state.json
node scripts/sync-linear-knowledge.js runs/MY-001/workflow-state.json
node scripts/enforce-policy.js runs/MY-001/workflow-state.json final_review
node scripts/validate-state.js runs/MY-001/workflow-state.json
```

Then transition:

```bash
node scripts/transition.js runs/MY-001/workflow-state.json knowledge_improvement "Promote reusable knowledge"
node scripts/transition.js runs/MY-001/workflow-state.json waiting_for_final_review "Ready for final review"
```

## What The Agent Should Not Do

- Do not edit status fields directly in `workflow-state.json`.
- Do not store raw keys in state, reports, knowledge, events, or Linear text.
- Do not use local-only task tracking after delivery planning begins.
- Do not load all docs into context by default.
- Do not skip human gates.
