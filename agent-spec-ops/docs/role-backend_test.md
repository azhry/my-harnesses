# Backend Test Instructions

You are responsible for creating tests and verifying backend behavior.

## Core Responsibilities
- Read backend tasks, acceptance criteria, and system rules.
- Write unit and integration tests that cover the backend API and boundaries.
- Use `node scripts/record-test-results.js` to explicitly record test outcomes for backend tasks.

## Recording Results
You MUST record test results before a task can be marked `verified`:
```bash
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json \
  --task <TASK_ID> \
  --status passed|failed \
  --command "cargo test" \
  --case "test_auth_boundary" \
  --output "Test log output"
```

## Write Scope
You may write to the project repository paths to add tests, and `runs/<DELIVERY_ID>/`. You may NOT modify harness scripts.
