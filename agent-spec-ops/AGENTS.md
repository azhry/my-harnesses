# Agent Instructions

Use this harness when a request needs to move from product/spec understanding
through frontend/backend implementation and verification.

## Operating Rules

- Treat `workflow-state.json` as the operational record.
- Do not invent implementation scope in dev roles. If scope is missing or
  conflicting, record a blocker and route the loop back to Product Manager or
  Project Manager.
- Frontend/backend dev tasks must follow the git lifecycle: create a feature
  branch from `main`, implement the task, wait for successful test evidence,
  push the feature branch, create a merge request back to `main`, then merge it
  by default unless `git_flow.auto_merge` is explicitly false.
- Follow WIP=1 within each lane. A lane may only have one `active` task.
- Every important claim needs evidence in `knowledge.findings[]` or
  `observability.verification_records[]`.
- Record durable learning in the local memory store. Disapprovals, changes,
  decisions, patterns, work completed, evals, and remarks must be written with
  the memory scripts instead of kept only in chat.
- A task cannot be `verified` until its declared verification evidence exists.
- A loop cannot exceed `max_attempts`; repeated failure should transition to
  `blocked` or a human/planning gate.
- Human gates are required only for product approval, delivery plan approval,
  and final acceptance.
- **Tool readiness must go through the human gate.** After running
  `scripts/check-tool-readiness.js`, transition to
  `waiting_for_tool_readiness_review` and present the readiness report to the
  human. Do not skip to `knowledge_discovery` without human approval.
  Tokens/PATs may be prompted interactively, but raw token values must never be
  written to state, reports, logs, or comments.
- **All agent-generated output must go inside `runs/<DELIVERY_ID>/`.**
  Never write scripts, templates, reports, design assets, or any other file
  outside the run directory. The write scope for each role is:
  - Product Manager: `runs/<DELIVERY_ID>/product-requirements.md`,
    `runs/<DELIVERY_ID>/stitch-ui-prompt.md`,
    `runs/<DELIVERY_ID>/design-assets/`,
    `runs/<DELIVERY_ID>/system-rules.md`,
    `runs/<DELIVERY_ID>/ui-design-spec.md`
  - Project Manager: `runs/<DELIVERY_ID>/task-breakdown.md`
  - Dev/Test roles: the project repo's approved paths (not harness files)
  - Orchestrator: `runs/<DELIVERY_ID>/workflow-state.json` and memory files
- **After writing the Stitch prompt in `ui_design_prompt`, transition to
  `design_assembly` to fetch the actual design screens.** Use the Stitch API to
  retrieve generated screens and save them as HTML files under
  `runs/<DELIVERY_ID>/design-assets/`. Only then transition to `system_rules`.
- **Every task in the task breakdown must have a non-empty `description` and at
  least one `acceptance_criterion`.** Thin one-line tasks are not allowed. The
  `validate-state.js` script enforces this before
  `waiting_for_delivery_plan_review`.
- Run `scripts/check-contracts.js` and `scripts/check-scope.js` before final
  review. Do not mark integration passed with failed or blocked contract/scope
  checks.
- When `agent_dispatch.spawn_requests[]` contains planned requests and this
  runtime supports agent spawning, the orchestrator may spawn workers for those
  requests. Role agents must not change top-level workflow state.

## Role Routing

| Role | Reads | Writes |
| --- | --- | --- |
| Product Manager | Intake, knowledge findings | Requirements, Stitch prompt, UI/system rules |
| Project Manager | Approved product artifacts | Task graph, dependencies, definitions of done |
| Frontend Dev | Approved frontend tasks | Frontend implementation evidence |
| Frontend Test | Frontend tasks and implementation | Test cases, failures, verification evidence |
| Backend Dev | Approved backend tasks | Backend implementation evidence |
| Backend Test | Backend tasks and implementation | Unit/integration tests, failures, verification evidence |
| Orchestrator | All state | Transitions, blockers, integration checks, handoff |

## Tool Readiness

Before relying on tracker or code-host data, choose and check:

- Linear or Atlassian
- GitHub or GitLab
- Frontend tooling
- Backend tooling

Use:

```bash
node scripts/check-tool-readiness.js runs/<DELIVERY_ID>/workflow-state.json
```

Do **not** proceed past `tool_readiness` without human acknowledgment.
Transition to `waiting_for_tool_readiness_review` and present the readiness
report to the human. Wait for approval before moving to `knowledge_discovery`.

Use `partial` only when missing capabilities are not required for the next phase
or are recorded as blockers/gaps.

When Linear/Jira is unavailable, use the local task tracker:

```bash
node scripts/update-local-task.js runs/<DELIVERY_ID>/workflow-state.json --id <TASK_ID> --status planned
```

The readiness script records this fallback in `memory.local_task_provider`.

## Local Memory

Record human disapprovals, change requests, decisions, patterns, and completed
work as events:

```bash
node scripts/record-event.js runs/<DELIVERY_ID>/workflow-state.json --type human_disapproval --summary "..."
```

Record scored evaluations and review remarks into CSV history:

```bash
node scripts/record-eval.js runs/<DELIVERY_ID>/workflow-state.json --metric "..." --finding "..."
node scripts/record-remark.js runs/<DELIVERY_ID>/workflow-state.json --summary "..."
```

Record token and cost usage after each meaningful run, task, eval, or tool-heavy
agent segment when the runtime exposes usage:

```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json --scope task --task <TASK_ID> --input-tokens <N> --output-tokens <N> --total-cost-usd <N> --cost-basis actual
```

Use `--cost-basis estimated` only when cost is calculated from recorded token
counts and a cited rate. Use `--cost-basis unknown` when token counts are known
but price is not.

Before starting role work, query relevant future-use memory:

```bash
node scripts/query-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE> --task <TASK_ID>
```

Do not promote a candidate knowledge card to `active` unless there is human
approval, repeated evidence, or a completed post-run eval supporting it.

## Run Monitoring

Use the local read-only monitor when you need a quick overview of active runs:

```bash
npm run monitor
```

The monitor reads `runs/`, `history/`, and `knowledge/cards/`; it does not
change workflow state.

## Measurement

Before final review:

```bash
node scripts/check-contracts.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/check-scope.js runs/<DELIVERY_ID>/workflow-state.json
```

Contract checks compare approved expected fields with actual producer and
consumer fields. Scope checks compare actual changed paths with approved task
scope. Failed or blocked checks must route back to Project Manager, Product
Manager, or implementation work.

## Dev Git Lifecycle

For every `frontend_dev` and `backend_dev` task:

1. Create the task feature branch from `main`.
2. Implement only the approved task scope.
3. Record changed files and implementation evidence.
4. Wait for matching test evidence to pass.
5. Push the feature branch.
6. Create a merge request/pull request targeting `main`.
7. Merge the merge request by default after merge checks pass.
8. Record `git_flow` branch, push, test, MR, merge-check, and merge evidence.

Do not mark a dev task `verified` until `git_flow.local_tests_passed`,
`git_flow.pushed`, `git_flow.merge_request_url`, and, when auto-merge is
enabled, `git_flow.merged` are recorded.

## Multi-Agent Dispatch

To plan automatic parallel dispatch:

```bash
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
```

The script creates planned spawn requests only for dependency-ready tasks with
explicit, non-overlapping write scopes. After the orchestrator spawns a worker,
record the agent ID:

```bash
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <SPAWN_REQUEST_ID> <AGENT_ID>
```

## Stop Conditions

Stop and ask for human input when:

- A human gate is reached.
- The same loop failure repeats and `attempt >= max_attempts`.
- A task requires a product or architecture decision outside the approved plan.
- Knowledge discovery cannot verify a source needed for task execution.
- Final verification contradicts approved acceptance criteria.
