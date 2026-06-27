# Workflow State Size

`workflow-state.json` is intentionally durable, but it should stay operational.
It should answer: what state are we in, what task is active, what is blocked,
what evidence exists, and what must happen next. It should not become the full
archive of every observation.

## Current Strategy

The current harness keeps one canonical state file and moves noisy history out
with:

```bash
node scripts/compact-state.js runs/<DELIVERY_ID>/workflow-state.json
```

Compaction:

- keeps recent `log[]` entries;
- trims old loop histories;
- trims old task loop histories;
- writes older entries to `runs/<DELIVERY_ID>/archives/`;
- writes `runs/<DELIVERY_ID>/workflow-summary.json`.

This is the safest default because existing scripts can still use one source of
truth.

## Can We Break It Down?

Yes. The natural split is:

```text
runs/<DELIVERY_ID>/
  workflow-state.json        # small canonical pointer/state file
  workflow-summary.json      # compact recovery packet
  state/
    delivery.json
    roles.json
    tool-readiness.json
    knowledge.json
    artifacts.json
    task-graph.json
    implementation.json
    integration.json
    gates.json
    memory.json
    evaluation.json
  events.ndjson
  token-usage.csv
  remarks.csv
  evals.csv
  knowledge/
  archives/
```

The canonical `workflow-state.json` would contain only:

```json
{
  "harness": {"name": "agent-spec-ops", "version": "0.1.0"},
  "current_state": "implementation_in_progress",
  "delivery": {"id": "MY-001", "updated_at": "..."},
  "state_files": {
    "task_graph": "state/task-graph.json",
    "gates": "state/gates.json",
    "integration": "state/integration.json"
  }
}
```

Scripts would load the composed state, mutate one section, then write the
section back.

## Tradeoffs

| Approach | Pros | Cons |
| --- | --- | --- |
| Single state file | Simple, easy to validate, easy for agents to inspect, fewer partial-write problems | Gets large, tempts agents to read too much, noisy diffs |
| Single state + compaction | Low-risk, current scripts mostly unchanged, keeps active state readable | Still has one growing operational object, compaction must be run |
| Split state files | Smaller context slices, cleaner diffs, role agents can read only their section | More loader/writer complexity, risk of inconsistent writes, every script must use composed-state APIs |
| External-first state | Linear/GitHub become primary records; local state is mostly cache | Less local bloat, better human visibility | Requires reliable network/API access, more failure modes, harder offline work |

## Recommendation

Use a staged migration:

1. Keep the single canonical state file.
2. Compact aggressively using `compact-state.js`.
3. Add a composed-state module that can read either single-file or split state.
4. Move the largest sections first: `task_graph`, `knowledge`, `observability`,
   and `log`.
5. Make all scripts use the composed-state module.
6. After all scripts use the module, shrink `workflow-state.json` to a pointer
   file.

This avoids breaking the current harness while still giving agents smaller
context packets over time.

## What Should Move Out First?

Move these first because they grow fastest:

- `log[]`
- task loop histories
- `observability.task_trace`
- `observability.diagnostic_log`
- large `knowledge.findings[]`
- repeated evidence strings

Keep these in the canonical state until the split loader is mature:

- `current_state`
- `delivery.id`
- `tool_readiness.status`
- `gates.*.status`
- `task_graph.tasks[].id/status/role/linear_id`
- active blockers

## Agent Context Rule

Agents should read in this order:

1. `workflow-summary.json` if present.
2. `workflow-state.json`.
3. `read-instructions.js` compact packet.
4. Specific detailed docs only when needed.

Agents should not load archived state unless diagnosing old decisions.
