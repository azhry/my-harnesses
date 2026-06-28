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

The harness uses Node.js and the dependencies declared in `package.json`.

```bash
node --version
git --version
npm install
```

Set required external-system credentials in the shell that launches the agent,
or store them in the harness-local untracked secrets file. Raw keys must not be
written to state, Linear issue bodies, knowledge cards, logs, or reports.

```bash
export LINEAR_API_KEY="lin_api_..."
export LINEAR_TEAM_ID="..."
export LINEAR_PROJECT_ID="..."   # recommended when creating issues
export GITHUB_TOKEN="ghp_..."    # or GH_TOKEN
export GOOGLE_STITCH_API_KEY="..." # optional, for fetching Google Stitch designs
```

PowerShell:

```powershell
$env:LINEAR_API_KEY="lin_api_..."
$env:LINEAR_TEAM_ID="..."
$env:LINEAR_PROJECT_ID="..."
$env:GITHUB_TOKEN="ghp_..."
$env:GOOGLE_STITCH_API_KEY="..."
```

For sessions that should remember credentials automatically for every run under
this harness, copy the example file to the harness root and fill in real values:

```bash
cp .agent-spec-ops.secrets.env.example .agent-spec-ops.secrets.env
```

PowerShell:

```powershell
Copy-Item .agent-spec-ops.secrets.env.example .agent-spec-ops.secrets.env
```

`.agent-spec-ops.secrets.env` is gitignored and loaded by harness scripts before
they check external-tool configuration, including Linear, GitHub, and Google
Stitch.

For different credentials per work item, put a secrets file inside that run:

```text
runs/MY-001/.agent-spec-ops.secrets.env
```

State-aware scripts load secrets in this order:

```text
1. AGENT_SPEC_OPS_SECRETS_FILE
2. runs/<DELIVERY_ID>/.agent-spec-ops.secrets.env
3. agent-spec-ops/.agent-spec-ops.secrets.env
4. agent-spec-ops/.env.agent-spec-ops
```

Earlier files win for variables they define. You can also keep the file outside
the repo and point to it once from your shell profile:

```bash
export AGENT_SPEC_OPS_SECRETS_FILE="$HOME/.config/agent-spec-ops/secrets.env"
```

PowerShell profile:

```powershell
$env:AGENT_SPEC_OPS_SECRETS_FILE="$HOME\.config\agent-spec-ops\secrets.env"
```

The state file stores only safe metadata such as key presence, masked
fingerprint, team ID, project ID, and verification time.

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

## Generate Project Agent Context

Write or refresh `AGENTS.md` in the project repo root so agents launched inside
the project automatically see the harness workflow, current delivery, Linear
sync rule, task scopes, design asset location, and durable knowledge pointers:

```bash
node scripts/generate-project-agents.js runs/MY-001/workflow-state.json \
  --project-repo /path/to/workspace/product-repo \
  --role orchestrator
```

Run it after task planning, Linear sync, design fetches, important project
knowledge updates, gate decisions, and major implementation changes. The script
updates only the `agent-spec-ops:managed` block and preserves project-specific
content outside that block.

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
