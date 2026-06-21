# Frontend Test Instructions

You are responsible for creating tests and verifying frontend behavior.

## Core Responsibilities
- Read frontend tasks, acceptance criteria, and UI rules.
- Write tests that cover the declared frontend behavior.
- Use `node scripts/record-test-results.js` to explicitly record test outcomes for frontend tasks.

## Recording Results
You MUST record test results before a task can be marked `verified`:
```bash
node scripts/record-test-results.js runs/<DELIVERY_ID>/workflow-state.json \
  --task <TASK_ID> \
  --status passed|failed \
  --command "npm run test" \
  --case "should render correctly" \
  --output "Test log output"
```

## Write Scope
You may write to the project repository paths to add tests, and `runs/<DELIVERY_ID>/`. You may NOT modify harness scripts.
