# Agent Spec Ops

Stateful multi-role harness for turning a product/spec request into planned,
implemented, tested, and reviewed frontend/backend delivery work.

This project is intentionally self-contained. The scripts use only Node.js
built-ins, so the harness can validate and create workflow runs without an npm
install.

## What This Harness Does

The harness coordinates these roles through explicit artifacts and bounded
feedback loops:

| Role | Responsibility |
| --- | --- |
| Product Manager | Requirements, acceptance criteria, Google Stitch prompt, UI rules, system rules |
| Project Manager | Executable frontend/backend/test task graph |
| Frontend Dev | Frontend implementation tasks |
| Frontend Test | Frontend test creation and verification |
| Backend Dev | Backend implementation tasks |
| Backend Test | Unit and integration test creation and verification |
| Orchestrator | State transitions, knowledge evidence, integration checks, handoff |

The central rule is:

```text
requirement -> rule -> task -> implementation -> test -> evidence
```

Agents should not keep important decisions only in chat. Decisions, evidence,
blockers, loops, and handoffs belong in `runs/<DELIVERY_ID>/workflow-state.json`.
Reusable learning belongs in the local memory files next to the run and, when
promoted, in `knowledge/cards/`.

## Quick Start

Create a new workflow run:

```bash
node scripts/new-delivery.js FTR-123 "Driver cancellation reason UI"
```

Check required access/tooling:

```bash
node scripts/check-tool-readiness.js runs/FTR-123/workflow-state.json
```

The readiness script prompts for:

- Linear or Atlassian
- GitHub or GitLab
- Missing access tokens/PATs

Tokens are accepted for the current session only and are not written into
`workflow-state.json`.

Validate the generated state:

```bash
node scripts/validate-state.js runs/FTR-123/workflow-state.json
```

Record local memory when a human rejects, changes, or clarifies something:

```bash
node scripts/record-event.js runs/FTR-123/workflow-state.json \
  --type human_disapproval \
  --summary "Success metric is unclear" \
  --details "Add measurable conversion and latency targets."
```

Record evals and remarks into CSV history:

```bash
node scripts/record-eval.js runs/FTR-123/workflow-state.json \
  --metric "planning quality" \
  --status warning \
  --finding "Task scope needs clearer backend/frontend boundary."

node scripts/record-remark.js runs/FTR-123/workflow-state.json \
  --kind pattern \
  --summary "Checkout changes often need explicit latency targets."
```

Record token and cost usage after run, task, or eval work:

```bash
node scripts/record-token-usage.js runs/FTR-123/workflow-state.json \
  --scope task \
  --task FE-001 \
  --role frontend_dev \
  --provider openai \
  --model gpt-5 \
  --input-tokens 12000 \
  --output-tokens 2800 \
  --total-cost-usd 0.23 \
  --cost-basis actual \
  --source "runtime usage summary"
```

Move through a legal transition:

```bash
node scripts/transition.js runs/FTR-123/workflow-state.json knowledge_discovery "Intake normalized"
```

Plan automatic multi-agent dispatch after delivery plan approval:

```bash
node scripts/plan-agent-dispatch.js runs/FTR-123/workflow-state.json --enable-auto
```

Monitor local runs in a browser:

```bash
npm run monitor
```

Then open `http://127.0.0.1:8787`.

Measure contract and scope alignment before final review:

```bash
node scripts/check-contracts.js runs/FTR-123/workflow-state.json
node scripts/check-scope.js runs/FTR-123/workflow-state.json
```

Validate the harness package:

```bash
node scripts/validate-harness.js
```

## Workflow States

The top-level states are:

```text
intake
tool_readiness
waiting_for_tool_readiness_review  ← new: human must approve readiness before proceeding
tool_readiness_revision            ← new: re-run checks after human revision request
knowledge_discovery
product_requirements
ui_design_prompt
design_assembly                    ← new: fetch actual Stitch design screens to runs/<ID>/design-assets/
system_rules
waiting_for_product_review
product_revision
product_approved
task_breakdown
waiting_for_delivery_plan_review
task_revision
delivery_plan_approved
implementation_in_progress
frontend_dev
frontend_test
frontend_verified
backend_dev
backend_test
backend_verified
integration_verification
waiting_for_final_review
done
blocked
```

See [docs/workflow.md](docs/workflow.md) for the transition graph.

## Automatic Agent Dispatch

The harness can plan automatic multi-agent work through
`agent_dispatch.spawn_requests[]`. The local script creates safe spawn requests;
the orchestrator agent executes them using the active runtime's agent-spawning
tool and records the returned agent ID with `scripts/record-agent-spawn.js`.

See [docs/agent-dispatch.md](docs/agent-dispatch.md).

## Run Monitor UI

The local monitor reads `runs/`, `history/`, and `knowledge/cards/` and shows
run state, gates, loops, tasks, readiness, dispatch, eval rows, remarks, and
memory events.

```bash
npm run monitor
```

See [docs/monitor-ui.md](docs/monitor-ui.md).

## Dev Git Lifecycle

Every `frontend_dev` and `backend_dev` task follows the same lifecycle:

```text
create feature branch from main
implement approved task scope
wait for successful matching test evidence
push feature branch
create merge request / pull request to main
merge the request by default after merge checks pass
```

The lifecycle is recorded in each dev task's `git_flow` object and enforced by
`scripts/validate-state.js`. Set `git_flow.auto_merge=false` or
`implementation.git_policy.auto_merge_default=false` with a reason when you want
the agent to stop before merge.

## Contract And Scope Measurement

Contract mismatch is measured by comparing approved expected fields with actual
producer and consumer fields. Scope issue is measured by comparing actual
changed paths with approved task/path scope.

See [docs/measurement.md](docs/measurement.md).

## Human Gates

The harness uses three hard human gates:

| Gate | Purpose |
| --- | --- |
| Product review | Confirm requirements, acceptance criteria, UX intent, and system rules |
| Delivery plan review | Confirm the task graph is executable and testable |
| Final review | Confirm the implemented result is acceptable |

Implementation and test rework loops do not require human approval unless they
change scope, conflict with product rules, or exceed the loop attempt budget.

## Knowledge Discovery

Knowledge is organized into five buckets:

| Bucket | Purpose |
| --- | --- |
| `product_knowledge` | Requirements, prior specs, user problem, acceptance criteria |
| `design_knowledge` | UI patterns, Stitch prompt inputs, interaction behavior |
| `system_knowledge` | APIs, services, data models, permissions, business rules |
| `repository_knowledge` | Repos, files, implementation patterns, test references |
| `verification_knowledge` | Unit, integration, e2e, manual verification paths |

Every important finding should cite authoritative evidence. Fast indexes and
summaries can propose candidates, but source verification should confirm claims
before tasks depend on them.

See [docs/knowledge-discovery.md](docs/knowledge-discovery.md).

## Local Memory And Fallback Tasks

Every run has local durable memory:

```text
runs/<DELIVERY_ID>/events.ndjson
runs/<DELIVERY_ID>/tasks.json
runs/<DELIVERY_ID>/evals.csv
runs/<DELIVERY_ID>/remarks.csv
runs/<DELIVERY_ID>/token-usage.csv
runs/<DELIVERY_ID>/knowledge/
```

Cross-run knowledge lives in `knowledge/cards/`, and historical eval/remark
CSV rows plus token-usage rows live in `history/`. When Linear/Jira is unavailable, the harness uses
`runs/<DELIVERY_ID>/tasks.json` as the local task tracker:

```bash
node scripts/update-local-task.js runs/FTR-123/workflow-state.json \
  --id FE-001 \
  --title "Implement checkout summary panel" \
  --role frontend_dev \
  --status planned
```

Query future-use memory before a role starts:

```bash
node scripts/query-knowledge.js runs/FTR-123/workflow-state.json --role frontend_dev --task FE-001
```

See [docs/local-memory.md](docs/local-memory.md).

## Project Layout

```text
agent-spec-ops/
  AGENTS.md
  README.md
  harness.yaml
  package.json
  docs/
  history/
  knowledge/
  schemas/
  ui/
  templates/
  examples/
  scripts/
  runs/
```

`runs/` is where generated workflow runs live. Keep reusable harness templates
and rules outside `runs/`.
