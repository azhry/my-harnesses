# Agent Instructions

Use this harness when a request needs to move from product/spec understanding
through frontend/backend implementation and verification.

## Session Start (Required)

When starting a new session on an existing delivery, immediately run context
recovery to restore Linear/project/token awareness:

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json
```

This dumps current state, task summary, Linear issue mappings, token totals,
tool readiness status, and gate status. Read the output carefully before taking
any action. Do not assume context from previous sessions carries over.

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
- **Never batch task status updates.** Each task must move through its lane
  state machine individually via `scripts/transition-task.js`. Do not edit
  `task.status` in the state file directly. Do not skip from `planned` to
  `verified` in one step — the script enforces the `planned → active →
  implemented → testing → verified` sequence.
- **Do not jump top-level state past lane sub-states.** Use
  `scripts/transition.js` only for non-implementation transitions (intake
  through delivery plan approval, integration_verification through done). For
  implementation lane work, always use `scripts/transition-task.js`. The
  `transition.js` script will reject `implementation_in_progress →
  integration_verification` if any dev tasks are unverified.
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
node scripts/generate-readme.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/generate-api-docs.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/generate-examples.js runs/<DELIVERY_ID>/workflow-state.json
```

Contract checks compare approved expected fields with actual producer and
consumer fields. Scope checks compare actual changed paths with approved task
scope. Failed or blocked checks must route back to Project Manager, Product
Manager, or implementation work.

Generate README, API docs, and example payloads before final review so the
reviewer has complete delivery artifacts. These go inside `runs/<DELIVERY_ID>/`
and are linked from the monitor UI.

## Artifact Generation (Phase 3)

Generate delivery artifacts after tasks are verified and before final review:

```bash
node scripts/generate-readme.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/generate-api-docs.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/generate-examples.js runs/<DELIVERY_ID>/workflow-state.json
```

These create:
- `runs/<DELIVERY_ID>/README.md` — task table, contract listing, gate status
- `runs/<DELIVERY_ID>/api-docs.md` — field-level contract documentation
- `runs/<DELIVERY_ID>/example-payloads.md` — JSON examples from contract fields

Run all three before final review to ensure artifacts are complete. Each script
records an `artifact_generated` event.

## Recording Test Results (Phase 4)

After running tests for a task, record the results:

```bash
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json \
  --task <TASK_ID> \
  --status passed|failed \
  --command "npm test" \
  --case "should render correctly" \
  --evidence "tests/file.test.ts" \
  --output "Test output text or log content"
```

Options:
- `--command` repeatable — test commands that were run
- `--case` repeatable — individual test case names
- `--evidence` repeatable — files or references proving tests ran
- `--output` — test output text; saved to `runs/<DELIVERY_ID>/test-output/<task>.log`
- `--failure` repeatable — descriptions of failures

Recording a `passed` result automatically sets `git_flow.local_tests_passed = true`
and populates `git_flow.test_evidence`.

The monitor UI shows a "Test Results" module with pass/fail counts, commands,
failure descriptions, and links to output logs.

## Linear Bidirectional Sync (Phase 5)

When Linear is configured (via `LINEAR_API_KEY` env var), sync tasks, knowledge,
and delivery status to Linear.

### Sync task status to Linear

```bash
# Sync all tasks
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json

# Sync a single task (must already have linear_id)
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --task <TASK_ID>

# Create Linear issues for tasks that don't have one yet
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create

# Preview without making changes
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Maps task status to Linear workflow states:
- `planned` → backlog, `active`/`implemented` → inProgress
- `testing` → inReview, `verified`/`waived`/`not_applicable` → done
- `failed` → canceled, `blocked` → blocked

### Sync knowledge cards to Linear documents

```bash
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --status active
node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Creates or updates a Linear document called "Knowledge — <DELIVERY_ID>" with all
active/promoted knowledge cards as markdown sections.

### Sync delivery status to Linear projects

```bash
node scripts/sync-linear-status.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/sync-linear-status.js runs/<DELIVERY_ID>/workflow-state.json --dry-run
```

Creates or updates a Linear project called "Delivery — <DELIVERY_ID>" with task
summary table, progress metrics, and status.

When `LINEAR_API_KEY` is not set, all Linear scripts exit silently with no
changes.

## Git Lifecycle Enforcement

Before marking a dev task `verified`, run the git lifecycle enforcement script to
verify that git claims (branch pushed, PR created, merge completed) match real
remote state:

```bash
node scripts/enforce-git-lifecycle.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> --repo-path /path/to/target/repo
```

If `repo_path` is set in `implementation.git_policy`, `transition-task.js` will
attempt this automatically. The script checks:
- Remote is configured
- Feature branch exists on remote via `git ls-remote`
- PR/MR exists via `gh pr view` (if gh CLI is available)
- Merge state matches what `git_flow` claims

Failures block the `verified` transition. Run `scripts/enforce-git-lifecycle.js`
standalone to see detailed per-check output.

## Final Review Instructions

Before transitioning to `waiting_for_final_review`, prepare and send review
instructions to the human reviewer. The review instructions must be recorded and
marked as sent:

```bash
node scripts/record-event.js runs/<DELIVERY_ID>/workflow-state.json --type human_instruction --summary "Final review instructions for <DELIVERY_ID>" --details "<CHECKLIST>"
```

Then update `workflow-state.json` to set:

```json
"human_instructions": {
  "final_review": {
    "status": "sent",
    "audience": ["human"],
    "instructions": "<CHECKLIST of what to review>",
    "decision_options": ["approve", "approve_with_followups", "request_rework", "block"],
    "questions": ["Question 1 for the reviewer...", "Question 2..."],
    "evidence": [{"at": "...", "event_id": "..."}]
  }
}
```

The `transition.js` script will reject the transition to
`waiting_for_final_review` if instructions are empty or status is not `sent`.

A good final review checklist includes:
1. **Contract checks** passed (`scripts/check-contracts.js`)
2. **Scope checks** passed (`scripts/check-scope.js`)
3. **All tasks** verified (no unverified frontend/backend/test tasks)
4. **Token/cost summary** within expected budget
5. **Knowledge cards** promoted for reusable learnings
6. **Artifacts** present (README, API docs if applicable)
7. **Evals** recorded for key milestones

## Per-Task State Transitions

Every task must move through its lane state machine using
`scripts/transition-task.js`. Do **not** edit `task.status` directly in the
state file.

```bash
node scripts/transition-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> <STATUS> "[NOTE]"
```

### Task Lane Transitions

```
planned  ──→ active ──→ implemented ──→ testing ──→ verified
  │          │              │               │
  └──→ blocked              └──→ failed ────┘
       waived
       not_applicable
```

### Rules Per Transition

- **planned → active**: All dependencies (`depends_on`) must be `verified`,
  `not_applicable`, or `waived`. WIP=1 enforced per role lane — only one
  `active` task per lane at a time.

- **active → implemented**: Code is written. Changed files and implementation
  evidence must be recorded in `task.implementation`.

- **implemented → testing**: Tests are running or ready to run.

- **testing → verified**: Git lifecycle must be complete:
  - `git_flow.local_tests_passed = true` with `test_evidence`
  - `git_flow.pushed = true` with `push_evidence`
  - `git_flow.merge_request_status` is `created`, `open`, or `merged` with URL
  - If `auto_merge = true`: `merge_checks_passed` and `merged` must be true

- **any → failed**: Records failure in `task.loop.last_failure` and increments
  attempt counter. After `max_attempts` retries, escalate via `blocked`.

- **any → blocked**: Stops work on this task. Requires a blocker description.

### Top-Level State Correlation

The top-level workflow state updates automatically when tasks transition:

| When all frontend tasks are... | Top-level state advances to |
|--------------------------------|---------------------------|
| `active` or `implemented` | `frontend_dev` |
| `testing` | `frontend_test` |
| `verified` | `frontend_verified` |
| `verified` (and backend done) | `integration_verification` |

| When all backend tasks are... | Top-level state advances to |
|------------------------------|---------------------------|
| `active` or `implemented` | `backend_dev` |
| `testing` | `backend_test` |
| `verified` | `backend_verified` |
| `verified` (and frontend done) | `integration_verification` |

Use `scripts/transition.js` only for non-implementation transitions
(intake through delivery plan approval, integration_verification through done).
For implementation lane work, always use `scripts/transition-task.js`.

Do **not** use `scripts/transition.js` to jump from `implementation_in_progress`
straight to `integration_verification` — this bypasses lane sub-states and will
be rejected if dev tasks are unverified.

## Dev Git Lifecycle

For every `frontend_dev` and `backend_dev` task:

1. Create the task feature branch from `main`.
2. Implement only the approved task scope.
3. Record changed files and implementation evidence.
4. Run tests and record results with `scripts/record-test-results.js`.
5. Push the feature branch.
6. Create a merge request/pull request targeting `main`.
7. Merge the merge request by default after merge checks pass.
8. Record `git_flow` branch, push, test, MR, merge-check, and merge evidence.
9. Run `scripts/enforce-git-lifecycle.js` to verify remote state before marking verified.

Do not mark a dev task `verified` until `git_flow.local_tests_passed`,
`git_flow.pushed`, `git_flow.merge_request_url`, and, when auto-merge is
enabled, `git_flow.merged` are recorded.

## Write Scope Enforcement

Before writing any file, verify it is within your role's allowed write scope:

```bash
node scripts/check-write-scope.js runs/<DELIVERY_ID>/workflow-state.json <TARGET_PATH> [ROLE]
```

The script exits 0 if allowed, 1 if denied. **Harness files are protected:**
- `scripts/`, `tests/`, `ui/`, `AGENTS.md`, `package.json`, `harness.yaml` — only orchestrator may modify these.
- Dev/test roles must write only to the project repo paths or `runs/<DELIVERY_ID>/`.
- PM/PM roles must write only to `runs/<DELIVERY_ID>/`.

If a task requires modifying a harness script, route through the orchestrator
role. Never edit harness files directly.

## Reopening Deliveries (Rework Flow)

When the human requests rework on a delivery at final review, do NOT transition
directly to `implementation_in_progress`. Instead, run the reopen script to
route through proper PM re-planning:

```bash
node scripts/reopen-delivery.js runs/<DELIVERY_ID>/workflow-state.json "Reason for rework"
```

This transitions to `task_breakdown` (not `implementation_in_progress`) and
resets final review state, clean_state, and gate status for a fresh cycle.

After reopening:
1. **Project Manager** updates task breakdown with revised/new tasks
2. Transition to `waiting_for_delivery_plan_review` for human approval
3. Transition to `delivery_plan_approved` after human approves
4. Transition to `implementation_in_progress` to start the next loop

Do **not** skip re-planning by jumping directly to `implementation_in_progress`.
The state machine now requires `waiting_for_final_review → task_breakdown`.

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
