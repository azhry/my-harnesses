# E2E Testing Workflow

This document defines the required sequence for running E2E tests (Cypress/Playwright) in the agent-spec-ops harness.

## Why This Exists

Agents were claiming E2E tests passed without actually running them. The root causes:
1. No preflight check for required servers (frontend dev server, backend API)
2. No enforcement that test commands were actually executed
3. No bounded timeout for E2E test runs
4. Agents could fabricate "36 tests passed" without any evidence

## Required Sequence

### 1. Preflight Check

Before any E2E test run, verify prerequisites:

```bash
cd ../my-harnesses/agent-spec-ops
node scripts/check-e2e-preflight.js runs/NL-001/workflow-state.json
```

This checks:
- Frontend dev server is reachable (default: localhost:3000)
- Backend API server is reachable (default: localhost:8080)
- Git working tree status

If preflight fails, **stop and report the blocker**. Do not proceed.

### 2. Start Servers (if not running)

```bash
# Frontend (in project directory)
npm run dev &

# Backend (if required, in backend directory)
go run . &
```

Wait for each to be ready:
- Frontend: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` returns 200
- Backend: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` returns 200

### 3. Run E2E Tests

Use `run-task-command.js` for bounded execution:

```bash
cd ../my-harnesses/agent-spec-ops
node scripts/run-task-command.js runs/NL-001/workflow-state.json <TASK_ID> \
  --role frontend_test \
  --label "cypress-e2e" \
  --timeout-ms 120000 \
  -- npx cypress run --headed --browser chrome --spec "cypress/e2e/<spec>.cy.ts"
```

### 4. Record Results

Pass the actual command output to `record-test-results.js`:

```bash
node scripts/record-test-results.js runs/NL-001/workflow-state.json \
  --task <TASK_ID> \
  --status passed \
  --role frontend_test \
  --command "npx cypress run --headed --browser chrome --spec cypress/e2e/feeding.cy.ts" \
  --require-output \
  --output "<actual test output>"
```

The `--require-output` flag enforces that real test output is provided.

### 5. Cleanup

Stop background servers after tests complete:

```bash
# Kill background processes
kill $(lsof -t -i:3000) 2>/dev/null
kill $(lsof -t -i:8080) 2>/dev/null
```

## What NOT To Do

- **Never** claim E2E tests pass without running them
- **Never** fabricate test output or pass/fail counts
- **Never** skip the preflight check
- **Never** run E2E tests without a bounded timeout
- **Never** rerun full suites on failure; capture first failure and stop
- **Never** use headless mode locally unless user explicitly asks

## Evidence Requirements

For E2E test evidence to be valid, `record-test-results.js` must have:

1. `--command` with the exact test command run
2. `--output` with the actual test output (enforced by `--require-output`)
3. `--evidence` with paths to screenshots/artifacts on failure
4. A corresponding `run-task-command.js` entry showing pass/fail/timeout
