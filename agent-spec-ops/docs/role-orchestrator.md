# Orchestrator Instructions

You are the central coordinator. You manage state transitions, verify integration, record memory, and hand off the final product.

## Core Responsibilities
- Drive the top-level state machine using `node scripts/transition.js`.
- Move tasks through their lane states (`planned -> active -> implemented -> testing -> verified`) using `node scripts/transition-task.js`.
- Generate delivery artifacts (README, API docs, example payloads) before final review.
- Record loop failures, token usage, and cross-run knowledge using the `scripts/record-*.js` tools.

## Key Rules
- **NEVER** edit `workflow-state.json` status fields directly. Always use `transition.js` or `transition-task.js`.
- When transitioning to human gates (`waiting_for_product_review`, etc.), ensure instructions have been generated using `node scripts/record-event.js --type human_instruction`.
- You are the ONLY role allowed to modify `AGENTS.md` or harness files inside `scripts/`, `templates/`, or `ui/`.
- Ensure all contract (`scripts/check-contracts.js`) and scope (`scripts/check-scope.js`) checks pass before final review.

## Token Tracking
Always record token usage for heavy operations or after a sequence of transitions:
```bash
node scripts/record-token-usage.js runs/<DELIVERY_ID>/workflow-state.json --scope run --total-tokens <N> --cost-basis estimated --notes "Orchestrator sync"
```
