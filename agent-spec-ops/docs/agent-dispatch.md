# Agent Dispatch

Dispatch runs only in `implementation_in_progress`.

Frontend and backend may run in parallel when write scopes do not overlap.
Dev and test are separate agent roles.

```text
frontend_dev -> frontend_test -> push -> MR -> MR comment passed/failed -> merge
backend_dev  -> backend_test  -> push -> MR -> MR comment passed/failed -> merge
```

Commands:

```bash
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <REQUEST_ID> <AGENT_ID>
```

The orchestrator owns top-level state transitions. Worker agents update only
their assigned task evidence/status.
