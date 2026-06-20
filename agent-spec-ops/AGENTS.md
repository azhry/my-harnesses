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

**First-time project initialization:** If this is a brand-new delivery (no
existing project repo yet), generate a project-level README.md after context
recovery and before starting any implementation work. The project README
documents the project's purpose, architecture, setup instructions, and how to
use the harness:

```bash
node scripts/generate-project-readme.js runs/<DELIVERY_ID>/workflow-state.json \
  --project-repo /path/to/project/repo \
  --readme-title "My Project" \
  --description "Brief project description"
```

This creates a `README.md` in the project repo root. Regenerate it when the
project scope, architecture, or task graph changes significantly.

## Operating Rules

- Treat `workflow-state.json` as the operational record.
- Do not invent implementation scope in dev roles. If scope is missing or
  conflicting, record a blocker and route the loop back to Product Manager or
  Project Manager.
- Frontend/backend dev tasks must follow the detailed Dev Git Lifecycle below:
  feature branch from `main` → implement → commit → test → push → PR → merge.
  **NEVER push commits directly to `main` or `master`.** All code changes must
  go through a feature branch and merge request. Pushing to the default branch
  is a hard violation — the enforce-git-lifecycle check will fail.
- Every PR/MR must have a substantive description following the format in
  the "Pull/Merge Request Description" section below.
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
- **Design assembly requires a human gate — do not skip it.** The flow is:
  `ui_design_prompt` → `waiting_for_design_stitch` (human gate) →
  `design_assembly` → `system_rules`. After writing the Stitch prompt, you
  MUST transition to `waiting_for_design_stitch` and present the prompt to the
  human. Ask them to provide a Stitch project URL + `GOOGLE_STITCH_API_KEY`
  (or at minimum a project ID). Once the gate is approved, transition to
  `design_assembly` and run `fetch-stitch-designs.js` to fetch the screens.
  **Google Stitch uses JSON-RPC, not REST** — always use
  `fetch-stitch-designs.js`, never `curl` or generic HTTP tools. Check the
  script's exit code and error output — if it reports JSON-RPC errors like
  `{"error":{"code":-32602,"message":"Tools Call name is not found"}}`, the
  fetch FAILED. Do NOT claim "designs exist" on error responses. Use
  `--list-methods` to probe available methods, then retry with `--method`.
  Save HTML files under `runs/<DELIVERY_ID>/design-assets/`. Only after
  successful fetch, transition to `system_rules`. See
  `docs/design-assembly.md` for the detailed process.
- **Every task in the task breakdown must have ALL of these fields populated:**
  `description`, `definition_of_done` (≥1 item), `expected_changes` (≥1 item),
  `verification` (≥1 item). The `validate-state.js` script enforces this before
  `waiting_for_delivery_plan_review`. Thin one-line tasks with no DoD or
  expected changes are rejected. When creating tasks in the state file or
  syncing to Linear, always set these fields — the Linear sync
  (`sync-linear-task.js`) reads them to build the Linear issue body.
- **After creating ALL tasks, you MUST sync them to Linear before transitioning
  to `waiting_for_delivery_plan_review`.** This is a hard requirement — the
  `transition.js` script will reject the transition if any task lacks a
  `linear_id`. Run:
  ```bash
  node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create
  ```
  Do NOT assume syncing happens automatically — the auto-sync was removed
  because it failed silently and gave false confidence. You must run this
  command explicitly and verify it produces no errors. If it fails, diagnose
  the issue (missing `LINEAR_API_KEY`, wrong team ID, network) and retry.
  Do NOT proceed to the transition until every task has a `linear_id`.
- **Record token and cost usage after every meaningful action — this is
  enforced before `verified`.** The `transition-task.js` script now rejects
  `testing → verified` if no non-zero token usage exists for the task. Run
  `scripts/record-token-usage.js` with real token counts after each task
  implementation, test run, eval, or tool-heavy session. Do not rely on
  auto-generated zero rows — they have been removed from the transition
  script.
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
- Run `scripts/check-contracts.js`, `scripts/check-scope.js`, and
  `scripts/check-harness-integrity.js` before final review. Do not mark
  integration passed with failed or blocked contract/scope checks or harness
  integrity violations.
- Run `scripts/verify-integration.js` before `integration_verification` to
  verify the project stack starts and responds correctly via docker compose.
  This is automatically invoked by `transition.js`; failures block the transition.
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

## Design Assembly (Google Stitch)

The design assembly flow ensures UI screens are generated via Google Stitch
before implementation begins. **Do not skip this flow** — the state machine
enforces it, and implementation tasks depend on design assets.

**Google Stitch uses JSON-RPC, not REST.** The fetch script sends JSON-RPC POST
requests by default. Do NOT use `curl`, `fetch`, or generic HTTP tools — always
use `fetch-stitch-designs.js`.

### CRITICAL RULE: Never claim success on API errors

After running `fetch-stitch-designs.js`, you MUST check:
1. The **exit code** (0 = success, non-zero = failure)
2. The **error output** — if the script reports JSON-RPC errors like
   `{"error":{"code":-32602,"message":"Tools Call name is not found"}}`,
   designs were NOT fetched. Do NOT claim "designs exist" or "fetch succeeded".
3. The `status` field in `artifacts.design_assets` — it will be `failed` or
   `partial` if errors occurred.

If the fetch fails, use `--list-methods` to probe available JSON-RPC methods,
then retry with `--method <name>`.

### Two paths

The human may provide:
- **Path A (preferred):** A Stitch project URL + API key — use `fetch-stitch-designs.js --url`
- **Path B:** Only a Stitch project ID — use `fetch-stitch-designs.js --project-id --list-methods`

### Step-by-step flow

```
ui_design_prompt → waiting_for_design_stitch → design_assembly → system_rules
```

1. **`ui_design_prompt`** — Product Manager writes the Stitch prompt using the
   template at `templates/stitch-ui-prompt.md` and saves the result to
   `runs/<DELIVERY_ID>/stitch-ui-prompt.md`. Update `artifacts.stitch_prompt`
   in the workflow state.

2. **Transition to `waiting_for_design_stitch`** — do NOT go directly to
   `design_assembly`. Present the Stitch prompt to the human and ask them to
   generate screens in Google Stitch, then provide:
   - The Stitch project URL
   - Their Google Stitch API key (`GOOGLE_STITCH_API_KEY`)
   If they only provide a project ID, use `--project-id` + `--list-methods`
   to discover the correct JSON-RPC method.

3. **Wait for human approval** — the `design_stitch` gate must be approved
   before proceeding.

4. **`design_assembly`** — after the gate approves, transition to
   `design_assembly`. Fetch the generated screens using:

   ```bash
   # Path A: Human provided URL + API key
   GOOGLE_STITCH_API_KEY=<key> node scripts/fetch-stitch-designs.js \
     runs/<DELIVERY_ID>/workflow-state.json --url <stitch_url>

   # If that fails, probe available JSON-RPC methods
   GOOGLE_STITCH_API_KEY=<key> node scripts/fetch-stitch-designs.js \
     runs/<DELIVERY_ID>/workflow-state.json --url <stitch_url> --list-methods

   # Then retry with the correct method
   GOOGLE_STITCH_API_KEY=<key> node scripts/fetch-stitch-designs.js \
     runs/<DELIVERY_ID>/workflow-state.json --url <stitch_url> --method <method>

   # Path B: Human provided only a project ID
   GOOGLE_STITCH_API_KEY=<key> node scripts/fetch-stitch-designs.js \
     runs/<DELIVERY_ID>/workflow-state.json --project-id <id> --list-methods
   ```

   The script saves each screen as a standalone HTML file:
   `runs/<DELIVERY_ID>/design-assets/<NN>-<screen-name>.html`
   and updates `artifacts.design_assets` in the workflow state.

   **Check the exit code and error output before proceeding.** If the script
   exits non-zero or reports JSON-RPC errors, do NOT continue to system_rules.

5. **Record design assets** — the script updates `artifacts.design_assets`
   automatically. Verify the status is `ready_for_review`, not `failed`.

6. **Transition to `system_rules`** — only after all design assets are saved
   and recorded.

### Enforcement

- The `transition.js` script requires `design_stitch` gate approval before
  allowing `design_assembly`.
- All design assets must go to `runs/<DELIVERY_ID>/design-assets/` — never to
  `/tmp`, the harness root, or anywhere else.
- The `fetch-stitch-designs.js` script exits with code 1 on failure — agents
  MUST check exit codes and never claim success on API errors.
- See `docs/design-assembly.md` for the detailed process, naming conventions,
  and evidence requirements.

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

For the **project repo itself**, use `scripts/generate-project-readme.js` to
create or update a `README.md` in the project root. This documents the project's
purpose, architecture, and setup instructions for human developers.

Run all three delivery artifact scripts before final review to ensure artifacts
are complete. Each script records an `artifact_generated` event.

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

Required environment variables:
- `LINEAR_API_KEY` — Linear API key (or `LINEAR_ACCESS_TOKEN`)
- `LINEAR_TEAM_ID` — Team ID for new issues

Optional environment variables:
- `LINEAR_PROJECT_ID` — Project ID for new issues (if unset, issues are created
  in the team's default project)

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

- **testing → verified**: Test execution evidence AND Git lifecycle must be complete:
  - `task.test.status` must be `"passed"` (recorded via `scripts/record-test-results.js`)
  - `task.test.last_run_at` must be set (tests were actually executed, not just claimed)
  - `task.test.commands` must contain at least one command
  - `task.test.failures` must be empty
  - `git_flow.local_tests_passed = true` with `test_evidence`
  - `git_flow.pushed = true` with `push_evidence`
  - `git_flow.merge_request_status` is `created`, `open`, or `merged` with URL
  - If `auto_merge = true`: `merge_checks_passed` and `merged` must be true

  Agents cannot skip test execution by setting `git_flow.local_tests_passed = true`
  directly — the `transition-task.js` script now requires `task.test` to have been
  populated via `record-test-results.js`. Always use `record-test-results.js` to
  record test outcomes.

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

### Knowledge Improvement Gate

Starting from `integration_verification`, the state machine now requires a
`knowledge_improvement` step before `waiting_for_final_review`:

```
integration_verification → knowledge_improvement → waiting_for_final_review
```

Transition to `knowledge_improvement` after integration checks pass. This state
is the signal to promote reusable knowledge cards and sync knowledge to Linear.
The `transition.js` script automatically syncs knowledge to Linear when entering
`knowledge_improvement` or `waiting_for_final_review` (if `LINEAR_API_KEY` is set).

After promoting knowledge and syncing to Linear, transition to
`waiting_for_final_review`:

## Dev Git Lifecycle

For every `frontend_dev` and `backend_dev` task — **you MUST follow these
steps in order. Do not skip any step. Do not push to main directly.**

### Step-by-step (run these exact commands):

```bash
# 1. Create the task feature branch from main
#    (branch naming is critical — use the delivery/task pattern)
git checkout main
git pull origin main
git checkout -b delivery/<DELIVERY_ID>/<TASK_ID>

# 2. Implement only the approved task scope.
#    (write code in the project repo)

# 3. Stage and commit with a descriptive message
git add -A
git commit -m "<TASK_ID>: <summary of changes>

- What changed and why
- Impact on related components
- Manual test instructions"
#    The commit message must reference the task ID.

# 4. Run tests and record results
#    (use record-test-results.js — see Recording Test Results section)
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json \
  --task <TASK_ID> --status passed --command "npm test" \
  --output "$(npm test 2>&1)"

# 5. Push the feature branch (NOT main)
git push origin delivery/<DELIVERY_ID>/<TASK_ID>

# 6. Create a merge request targeting main
#    IMPORTANT: Use the PR description format defined in the
#    "Pull/Merge Request Description" section below.
gh pr create \
  --base main \
  --head delivery/<DELIVERY_ID>/<TASK_ID> \
  --title "[<DELIVERY_ID>] <TASK_ID>: <short title>" \
  --body "$(cat templates/pull-request-template.md | \
    sed 's/<TASK_ID>/<TASK_ID>/g; s/<DELIVERY_ID>/<DELIVERY_ID>/g')"
#    Replace the template placeholders with actual content before creating.

# 7. Record git_flow evidence in the workflow state
#    (update workflow-state.json directly or via script)

# 8. Merge the MR by default after merge checks pass
#    (or set git_flow.auto_merge = true to auto-merge)

# 9. Run enforce-git-lifecycle to verify remote state
node scripts/enforce-git-lifecycle.js runs/<DELIVERY_ID>/workflow-state.json \
  <TASK_ID> --repo-path /path/to/project/repo
```

### Rules:

1. **Branch naming**: Always `delivery/<DELIVERY_ID>/<TASK_ID>`. Never use generic names like `feature/xyz` or `fix/abc`.
2. **No direct pushes to main**: `git push origin main` is FORBIDDEN. The enforcement script will reject it.
3. **Commit after every task**: Every task must result in at least one commit. Do not batch multiple tasks into one commit.
4. **MR before merge**: Always create a pull request. Do not merge locally and push — the enforce-git-lifecycle check requires a PR URL.
5. **PR description must be substantive** — see the "Pull/Merge Request Description" section for the required format.
6. **Do not skip the git lifecycle**: If a task has no code changes (e.g., config-only), still record git evidence explaining why no branch was needed.

### State fields to update after each step:

| After step | Set these in `task.git_flow` |
|------------|------------------------------|
| 1 (branch) | `feature_branch`, `base_branch`, `target_branch`, `branch_created = true`, `branch_evidence` |
| 3 (commit) | (commit is recorded in the branch) |
| 4 (test) | `local_tests_passed = true`, `test_evidence` |
| 5 (push) | `pushed = true`, `push_evidence` |
| 6 (MR) | `merge_request_status = "created"`, `merge_request_url` |
| 8 (merge) | `merge_checks_passed = true`, `merge_check_evidence`, `merged = true`, `merge_request_status = "merged"` |

Do not mark a dev task `verified` until ALL the above `git_flow` fields are
recorded. The `transition-task.js` script enforces this.

## State Field Maintenance

You MUST keep `workflow-state.json` fields current after every meaningful
action. The monitor UI reads these fields — stale state misleads both human
reviewers and future agent sessions.

### Checklist: fields to update and when

| Field | When to update | How |
|-------|---------------|-----|
| `tool_readiness.choices.product_tracker` | After tool readiness check | Edit directly or via `check-tool-readiness.js` |
| `tool_readiness.choices.code_host` | After tool readiness check | Edit directly or via `check-tool-readiness.js` |
| `tool_readiness.status` | After tool readiness check + human approval | Via `transition.js` |
| `token-usage.csv` (via `record-token-usage.js`) | After each agent run, task, eval, or tool-heavy segment | `node scripts/record-token-usage.js ...` |
| `task.git_flow.*` | After each git step (branch, test, push, MR, merge) | Edit directly — see Dev Git Lifecycle table |
| `task.implementation.changed_files` | After implementation | Edit directly |
| `task.implementation.evidence` | After implementation | Edit directly |
| `task.test.*` | After running tests | Via `record-test-results.js` |
| `task.status` | On each lane transition | **Always** via `transition-task.js` (never edit directly) |
| `state.current_state` | Auto-updated by `transition-task.js` | Check it after transitions |
| `memory.*` | After events, evals, remarks | Via respective record scripts |
| `delivery.updated_at` | On any change | Auto-set by scripts, or set manually |
| `artifacts.*` | After generating artifacts | Via artifact scripts or edit directly |
| `human_instructions.*` | When sending/finalizing review instructions | Edit directly |
| `gates.*` | When human approves/denies a gate | Edit directly |

### Token usage must be recorded regularly — enforced at verified

**This is now enforced.** The `testing → verified` transition requires at
least one non-zero token usage row for the task. If you skip token recording,
the transition will be rejected.

After every task implementation, test run, eval, or tool-heavy segment, record
actual token counts:

```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json \
  --scope task --task <TASK_ID> \
  --input-tokens <N> --output-tokens <N> --total-cost-usd <N> --cost-basis actual
```

If the runtime exposes token counts per API call, record them immediately
after the call. If it only exposes per-session or per-run totals, record a
cumulative row at the end of the session.

If the runtime does not expose per-call token counts, record an estimated
row at task boundaries so the monitor shows non-zero usage:

```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json \
  --scope task --task <TASK_ID> \
  --total-tokens <N> --total-cost-usd <N> --cost-basis estimated \
  --notes "Estimated from session totals"
```

### Context recovery at session start

When resuming an existing delivery, always run context recovery first:

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json
```

This dumps current state, task summary, Linear mappings, token totals,
tool readiness, and gate status. If any fields appear stale (e.g., old
timestamps, zero token counts after known work), update them before
proceeding.

## Pull/Merge Request Description

Every PR/MR must have a substantive description. The description is the
primary communication artifact for human reviewers — it explains what
changed, why, and how to verify it.

### Required PR/MR description format

```markdown
## Summary

<1-3 sentences describing what this PR does at a high level.>

## Task

- **Delivery:** <DELIVERY_ID>
- **Task:** <TASK_ID>
- **Description:** <task.description from workflow-state>

## Changes

- <file path>: <what changed and why>
- <file path>: <what changed and why>

## Impact

- **Frontend/Backend:** <which system(s) are affected>
- **Breaking:** Yes/No
- **Dependencies:** <new or changed dependencies>
- **Configuration:** <new env vars, config changes>

## Manual Test Instructions

1. <step-by-step instructions to verify the change>
2. <include specific commands, URLs, payloads>

## Related

- Closes <TASK_ID>
- Related MRs/Issues: <links>
```

### How to create a PR with this template

```bash
# Read the template, replace placeholders, then create
gh pr create \
  --base main \
  --head delivery/<DELIVERY_ID>/<TASK_ID> \
  --title "[<DELIVERY_ID>] <TASK_ID>: <short title>" \
  --body "$(cat templates/pull-request-template.md | \
    sed 's/<TASK_ID>/<TASK_ID>/g' | \
    sed 's/<DELIVERY_ID>/<DELIVERY_ID>/g')"
```

Better yet, write the body inline by filling in the template sections
with actual content from your task state. The description must be
meaningful — empty or one-line PR descriptions will be rejected by
human reviewers.

## Workspace Root

The workspace root is the **common ancestor directory** that contains both the
harness folder AND all project repos. It may be 0, 1, or 2 levels above the
harness depending on your project layout.

The harness reads `workspace_root` from `workflow-state.json` first. If not set,
it auto-detects by walking up from the harness until it finds a directory
containing all `allowed_repos` from task scopes. If auto-detect fails, it
defaults to the harness parent (`../`).

**All code files for tasks go into the project repo under workspace root, NOT into the harness directory.**

Typical layouts:

```
# Layout A: project inside workspace (workspace_root = ../)
Projects/
  my-workspace/
    agent-spec-ops/    ← harness
    my-project/        ← project repo
```

```
# Layout B: project as sibling of workspace (workspace_root = ../../)
Projects/
  my-harnesses/
    agent-spec-ops/    ← harness
  nala-guru/           ← project repo
```

When writing files from the harness CWD, prefix paths with the relative path
from harness to the project repo. For Layout B:
`../../nala-guru/backend/Dockerfile` — not `nala-guru/backend/Dockerfile`.

**Always use `read-context.js` output to determine the actual repo name and
write path** — it extracts approved repos from task scopes and displays them
at session start. Do not guess or hardcode.

### Getting the write path right

Run this check BEFORE writing any file:

```bash
node scripts/check-write-scope.js runs/<DELIVERY_ID>/workflow-state.json <TARGET_PATH> [ROLE]
```

This script auto-detects the workspace root and validates the target path
against every task's `allowed_repos` and `allowed_paths`. If it says OK, the
path is correct. If DENIED, the path is outside scope.

## Write Scope Enforcement

Before writing any file, verify it is within your role's allowed write scope:

```bash
node scripts/check-write-scope.js runs/<DELIVERY_ID>/workflow-state.json <TARGET_PATH> [ROLE]
```

The script exits 0 if allowed, 1 if denied. **Harness files are protected:**
- `scripts/`, `tests/`, `ui/`, `AGENTS.md`, `package.json`, `harness.yaml` — only orchestrator may modify these.
- Dev/test roles must write only to the project repo paths (`../<repo>/`) or `runs/<DELIVERY_ID>/`.
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

## Promoting Feedback as General Knowledge

Human feedback, bug reports, feature requests, and design critiques contain
reusable learning. When you receive significant human feedback (especially
about harness behavior, architecture patterns, or process improvements):

1. **Record as a knowledge card** with the feedback content, rationale, and
   context:
   ```bash
   node scripts/record-knowledge.js runs/<DELIVERY_ID>/workflow-state.json \
     --kind process_rule \
     --status promoted \
     --statement "Feedback: <summarized learning>" \
     --rationale "<why this matters>" \
     --tag feedback \
     --tag "<delivery-id>" \
     --evidence "human feedback from <source>"
   ```
   Knowledge is stored in the run directory by default. Use `--global` to
   store in the shared `knowledge/cards/` store for cross-run availability.

2. **Update AGENTS.md** if the feedback changes how agents should operate
   (but only the orchestrator may modify AGENTS.md — see Write Scope
   Enforcement).

3. **Sync to Linear** so the next session context recovery picks it up:
   ```bash
   node scripts/sync-linear-knowledge.js runs/<DELIVERY_ID>/workflow-state.json
   ```

Reusable knowledge types to promote:
- **Process fixes**: "Always check X before Y" or "Never skip Z step"
- **Tooling patterns**: "The backend needs WSL for Docker" or "Use npm not yarn"
- **Domain nuances**: "The client prefers REST over GraphQL" or "PIN must be numeric"
- **Harness improvements**: Feedback that becomes a script or state machine change

Do not promote one-off observations, transient debug info, or obvious
common sense as knowledge cards.

## Agent Best Practices

### Directory Navigation

When exploring the project repo, use `ls -alt` instead of `ls` to see hidden files
(e.g. `.env`, `.gitignore`, `.env.example`). Traverse directories deeply — do not
assume structure from file paths alone. Check subdirectories for configuration files.

### Known Project Issues (do not fix — documented for awareness)

- **`rounded-puffy` CSS class**: `frontend/src/index.css:100` references a
  `rounded-puffy` class that does not exist in Tailwind CSS. This is a project
  code issue in `nala-guru/` and must NOT be modified by the agent. Route to
  human if asked to fix it.

### Linear API Troubleshooting

If Linear API calls fail, run the connectivity test to verify environment setup:

```bash
node scripts/check-linear-connectivity.js runs/<DELIVERY_ID>/workflow-state.json
```

This tests the API key, lists available teams and projects with their IDs, and
shows which env vars are set. It avoids the common mistake of using shell
variable syntax (`$LINEAR_API_KEY`) inside `node -e` strings — always use
`process.env.LINEAR_API_KEY` in Node.js code.

### Integrity Checks

The harness now enforces the following automatically at key transitions.
Do not attempt to bypass them:

| Check | When | What it prevents |
|-------|------|-------------------|
| Test execution evidence | `testing → verified` | Setting `task.test.status = "passed"` manually without running tests |
| Scope/repo validation | `check-write-scope.js` + `testing → verified` | Writing to repos not in `allowed_repos` (e.g. `baby-math` instead of `nala-guru`) |
| Docker compose verification | `testing → verified` + `integration_verification` + `waiting_for_final_review` | Marking tasks verified without ensuring the stack still starts |
| Harness integrity | `waiting_for_final_review` | Modifying `scripts/`, `ui/`, `templates/`, `AGENTS.md`, etc. outside orchestrator role |
| Linear auto-sync | `read-context.js`, `implementation_in_progress` | Tasks without `linear_id` being missed in sync |
| Linear team/project validation | `sync-linear-task.js --create` | Creating issues without `LINEAR_TEAM_ID` set |

## Stop Conditions

Stop and ask for human input when:

- A human gate is reached.
- The same loop failure repeats and `attempt >= max_attempts`.
- A task requires a product or architecture decision outside the approved plan.
- Knowledge discovery cannot verify a source needed for task execution.
- Final verification contradicts approved acceptance criteria.
