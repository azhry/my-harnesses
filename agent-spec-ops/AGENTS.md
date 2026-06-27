# Agent Instructions

Use this harness when a request needs to move from product/spec understanding
through frontend/backend implementation and verification.

## Session Start (Required)

When starting a new session on an existing delivery, after session compaction,
after interruption, or after a role handoff, immediately run context recovery to
restore Linear/project/token awareness and get role-specific instructions:

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json --role <YOUR_CURRENT_ROLE>
```

The `--role` argument is highly recommended, as it will append specific instructions for your current role (e.g., `frontend_dev`, `product_manager`) so you don't have to read this entire document.
This dumps current state, task summary, Linear issue mappings, token totals,
tool readiness status, and gate status. Read the output carefully before taking
any action. Do not assume context from previous sessions carries over.

Before any state transition or task transition, confirm the context recovery
output still matches `workflow-state.json`. The transition scripts write and
check `runs/<DELIVERY_ID>/.session.json`; if they reject stale context, rerun
`read-context.js`, re-read the role instructions printed at the end, and retry.
Do not continue from chat memory after compaction.

For compact just-in-time instructions, run:

```bash
node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <YOUR_CURRENT_ROLE>
```

Use `read-context.js --full-instructions` only when the compact packet is not
enough.

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
- Treat `harness-policy.json` as the executable policy contract. Mutating
  scripts call `scripts/enforce-policy.js`/`scripts/lib/policy.js` and must fail
  closed when policy is violated.
- Linear is the required system of record for task management and promoted
  knowledge. Raw API keys must stay in environment variables; state may store
  only safe metadata such as key presence, fingerprint, team ID, project ID, and
  verification time.
- If `workflow-state.json` becomes noisy, run
  `node scripts/compact-state.js runs/<DELIVERY_ID>/workflow-state.json`.
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
- **When LINEAR_API_KEY is configured, create tasks directly in Linear — do NOT
  create task-breakdown.md.** Harness policy requires Linear as the task system
  of record after readiness. The `task-breakdown.md` template is only a
  bootstrap fallback before Linear is available. If `LINEAR_API_KEY` is set:
  1. Create the task graph in `workflow-state.json` (task_graph.tasks[])
  2. Run `node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create`
     to push all tasks to Linear as real issues
  3. Sync and manage those issues in Linear from that point on
  4. Do NOT write `task-breakdown.md` — it duplicates work and confuses the
     agent into treating a local file as the source of truth
  If `LINEAR_API_KEY` is NOT set, stop at readiness/planning and record a
  blocker. Do not proceed into approved delivery execution with local-only task
  management.
- **Task names must be clean descriptions.** A task name is
  something like "[FE-001] Implement login feature" or "Add error handling to API
  endpoint". Do NOT prefix task names with "RUN CODE", "TASK", "FEATURE",
  "STORY", "IMPLEMENT", or any other label. The task ID (e.g. `FE-001`)
  already identifies the task type and sequence. Putting redundant labels in
  the name field makes the Linear issue board unreadable.
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

Detailed role instructions are now located in `docs/role-<ROLE>.md`.
To view your specific role instructions, use the `--role` argument when running `read-context.js`.


## Reference Index (Just-In-Time Context)

> [!TIP]
> **Context Management**
> Do not guess or assume instructions for specific phases. Read the relevant document in the docs/ folder ONLY when you are actively working on that phase.

- **Tool Readiness & Tools**: docs/tool-readiness.md
- **Local Memory & Events**: docs/local-memory.md
- **Run Monitoring**: docs/monitor-ui.md
- **Design Assembly (Stitch)**: docs/design-assembly.md
- **Measurement & Tokens**: docs/measurement.md
- **Linear Bidirectional Sync**: docs/linear-sync.md
- **Git Lifecycle (Commits, PRs)**: docs/git-lifecycle.md
- **State Transitions & JSON Updates**: docs/state-transitions.md
- **Final Review & Human Gates**: docs/human-gates.md
- **Test Recording**: docs/verification.md

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
