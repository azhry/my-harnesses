# Agent Dispatch

Dispatch runs only in `implementation_in_progress`.

Frontend and backend may run in parallel when write scopes do not overlap.
Dev and test are separate agent roles.
Each lease must be recorded with the exact OpenCode adapter name:
`agent-spec-frontend-dev`, `agent-spec-frontend-test`,
`agent-spec-backend-dev`, or `agent-spec-backend-test`.

```text
frontend_dev -> frontend_test(record-test-results) -> submit-task(push/MR/comment/checks/merge)
backend_dev  -> backend_test(record-test-results)  -> submit-task(push/MR/comment/checks/merge)
```

Commands:

```bash
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <REQUEST_ID> <REAL_OPENCODE_SESSION_ID> --agent <AGENT_NAME>
```

The orchestrator owns top-level state transitions. Worker agents update only
their assigned task evidence/status.
Generic OpenCode agents such as `general`, `build`, or `explore` are not valid
implementation/test leases.
Raw `gh pr merge` is not a valid dispatch path. Use `submit-task.js`, which
requires passed MR checks before recording merged evidence.
Do not pass manual merge/check flags to `record-test-results.js` for dev tasks.

Run state is sealed after trusted script writes. If context recovery or state
validation reports an integrity error, stop dispatch; repair the state
intentionally, then run `seal-state.js` with the repair reason. Dispatch agents
must not use `seal-state.js` as a normal recovery command; it refuses invalid
workflow data.
