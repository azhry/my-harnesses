# DevCircuit

**From request to verified delivery.**

DevCircuit is a standalone end-to-end software engineering harness. It accepts a versioned specification and task plan, creates or reuses a Linear project, publishes the specification and tasks, runs one task at a time on its own GitHub branch, separates implementer/reviewer/gatekeeper/merger roles, loops failed review back to implementation, and prevents merge without current evidence.

It deliberately fails closed. Missing Linear, GitHub, review, or evidence state blocks progress.

## Requirements

- Node.js 20+
- `git` and GitHub CLI (`gh`), authenticated for the target repository
- `LINEAR_API_KEY` or `LINEAR_ACCESS_TOKEN`
- `DEVCIRCUIT_STATE_KEY` containing at least 32 random characters; state is authenticated with HMAC-SHA-256
- `DEVCIRCUIT_SANDBOX_RUNNER`, a trusted container/VM wrapper implementing `runner --cwd <path> --home <ephemeral-home> -- <executable> [args...]`
- A Linear team with statuses named exactly `Todo`, `In Progress`, `In Review`, and `Done`
- A protected GitHub base branch requiring CI, review, resolved conversations, and the trusted gate status in production

The controller process owns `DEVCIRCUIT_STATE_KEY`; worker agents never inherit it. Planner adapters, agent adapters, and repository commands fail closed unless they run through the configured sandbox runner with a new HOME and strict environment allowlist.

## Quick start

Start with the readiness audit. It reports available/missing tools, remote access, and whether a fix belongs to the agent or a human administrator:

```bash
npm run readiness -- --repo /path/to/product --github-repository owner/repository --base-branch main
```

Required failures block `intake` and `orchestrator` automatically.

Copy and fill the templates:

```bash
cp templates/specification.md /tmp/spec.md
cp templates/tasks.example.json /tmp/tasks.json
```

Use a planner adapter to turn a raw request into a versioned specification and task graph, then initialize a sealed run:

```bash
node scripts/dev-circuit.js intake \
  --run DEMO-001 \
  --title "Demo delivery" \
  --summary "Deliver the requested behavior" \
  --project-key demo-delivery-v1 \
  --team-id <LINEAR_TEAM_ID> \
  --github-repo owner/repository \
  --base-branch main \
  --request-file /tmp/request.txt \
  --planner-adapter /path/to/planner-adapter
```

Start the durable supervisor before delivery work:

```bash
npm run monitor
```

Create/reuse the Linear project, specification document, and issues:

```bash
node scripts/dev-circuit.js sync-linear --state runs/DEMO-001/workflow-state.json
```

Each agent adapter receives a context JSON path and must immediately return a runtime-issued lease as the final stdout line:

```json
{"agent_id":"runtime-session-id","principal":"distinct-runtime-principal","workspace_id":"distinct-worktree-id"}
```

The context also contains a random capability scoped to the task, role, and attempt plus a writable inbox path. Workers submit JSON payloads without reading or mutating controller state:

```bash
node /path/to/dev-circuit/scripts/submit.js \
  --inbox <context.submission.inbox> \
  --token <context.submission.capability_token> \
  --task <task-id> \
  --role implementer \
  --attempt <attempt> \
  --type implementation \
  --payload-file /tmp/submission.json
```

The orchestrator validates the capability hash, role, task, and attempt; independently captures Git HEAD and runs the contracted commands inside the sandbox; then—and only then—mutates HMAC-authenticated state. Old-attempt capabilities are rejected.

Start the durable controller. It synchronizes Linear before work, selects exactly one task, dispatches roles, opens the PR when implementation evidence is ready, advances review/gate/merge/post-merge states, and resumes by reading sealed state after restart:

```bash
node scripts/orchestrator.js \
  --watch \
  --state runs/DEMO-001/workflow-state.json \
  --repo /path/to/product \
  --adapter /path/to/agent-runtime-adapter
```

The following controller commands illustrate the evidence produced after validated inbox submissions. Workers do not receive the state key and do not invoke these state-mutating commands directly:

```bash
# After committed implementation, capture HEAD, then record current-SHA implementation and test evidence.
node scripts/dev-circuit.js capture-head --state runs/DEMO-001/workflow-state.json --task APP-001 --repo /path/to/product
node scripts/dev-circuit.js evidence --state runs/DEMO-001/workflow-state.json --task APP-001 --kind implementation --producer codex:/root/implement-app-001 --result pass --head-sha <SHA> --artifact <LOG_OR_URL>
node scripts/dev-circuit.js run-check --state runs/DEMO-001/workflow-state.json --task APP-001 --repo /path/to/product --producer codex:/root/implement-app-001 --label unit -- npm test

# Independent reviewer: fail returns Linear to In Progress; pass sets Done.
node scripts/dev-circuit.js run-check --state runs/DEMO-001/workflow-state.json --task APP-001 --repo /path/to/product --producer codex:/root/review-app-001 --label independent-review -- npm test
node scripts/dev-circuit.js evidence --state runs/DEMO-001/workflow-state.json --task APP-001 --kind manual_test --producer codex:/root/review-app-001 --result pass --head-sha <SHA> --step "Start the app"
node scripts/dev-circuit.js evidence --state runs/DEMO-001/workflow-state.json --task APP-001 --kind acceptance --producer codex:/root/review-app-001 --result pass --head-sha <SHA> --criterion "Observable outcome"
node scripts/dev-circuit.js review --state runs/DEMO-001/workflow-state.json --task APP-001 --repo /path/to/product --verdict pass --reviewer-id codex:/root/review-app-001 --head-sha <SHA> --summary "All criteria and negative paths pass"
```

## What is implemented

- Atomic, HMAC-SHA-256-authenticated state with monotonic revisions and controller locking; direct edits are rejected.
- WIP=1 task scheduler invariant.
- Immutable contract hashes and versioned specifications.
- Exact Linear status projection and read-after-write verification.
- Idempotent Linear project marker and create-if-missing behavior.
- Linear specification document and complete issue descriptions.
- Dedicated Git branch and PR per task.
- Exact-SHA implementation, test, review, gate, and merge evidence.
- Independent role leases; self-review/gating/merging is rejected.
- Review fail/rework loop and stale approval invalidation.
- Deterministic merge checklist with ALLOW/DENY.
- Continuous supervisor heartbeat and invariant audit.
- GitHub required-check inspection before merge.
- Post-merge verification state and At Risk handling.

## Verification

```bash
npm run validate
```

See the full [setup and operating tutorial](docs/tutorial.md), [runtime adapters](docs/runtime-adapters.md), [architecture](docs/architecture.md), and [certification](docs/certification.md).
