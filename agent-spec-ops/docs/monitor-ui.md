# Run Monitor UI

The harness includes a dependency-free local monitor for workflow runs.

Start it with:

```bash
npm run monitor
```

Or choose a port:

```bash
node scripts/monitor-runs.js --port 8787
```

Then open:

```text
http://127.0.0.1:8787
```

## What It Reads

The monitor reads local harness files only:

```text
runs/<DELIVERY_ID>/workflow-state.json
runs/<DELIVERY_ID>/tasks.json
runs/<DELIVERY_ID>/events.ndjson
runs/<DELIVERY_ID>/evals.csv
runs/<DELIVERY_ID>/remarks.csv
runs/<DELIVERY_ID>/token-usage.csv
history/evals.csv
history/remarks.csv
history/token-usage.csv
knowledge/cards/
```

It does not mutate state. Use the existing scripts to change tasks, events,
knowledge, evals, remarks, and transitions.

## Views

The overview shows:

- Total, active, done, and blocked runs
- Task totals and failed task count
- Pending gates and active loops
- Memory events and reusable knowledge cards

The run detail shows:

- Tool readiness and local task-provider mode
- Gate and loop progress
- Role statuses
- Integration, contract, and scope health
- Agent-dispatch status
- Task status and git lifecycle progress
- Recent memory events, eval rows, and remarks
- Token and cost totals, plus recent token-usage rows

The UI refreshes every 15 seconds and can be manually refreshed from the header.

## API

The monitor exposes read-only JSON endpoints:

| Endpoint | Purpose |
| --- | --- |
| `/api/runs` | Full dashboard payload |
| `/api/summary` | Same payload alias for simple clients |
| `/api/runs/<DELIVERY_ID>` | Single run payload |

These endpoints are intended for local use by agents, scripts, and humans.
