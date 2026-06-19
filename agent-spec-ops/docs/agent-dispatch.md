# Agent Dispatch

The harness supports automatic multi-agent dispatch when the runtime can spawn
agents. The local Node script does not spawn Codex agents by itself; it creates
machine-readable spawn requests that the orchestrator agent must execute using
the available agent runtime.

## Dispatch Planning

Run:

```bash
node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json --enable-auto
```

The planner creates `agent_dispatch.spawn_requests[]` only when:

- Current state is eligible for implementation work.
- `agent_dispatch.mode` is `multi_agent`.
- `agent_dispatch.auto_spawn` is `true`.
- Task dependencies are satisfied.
- Task write scopes are explicit.
- Selected tasks have non-overlapping `scope.allowed_paths`.
- WIP=1 is preserved per role.

## Spawn Request

Each request includes:

- Role
- Lane
- Task IDs
- Prompt
- Write scope
- Status

The orchestrator should spawn one worker per planned request when the runtime
supports it. In Codex, use the multi-agent spawn tool for each request.

After spawning, record the runtime agent ID:

```bash
node scripts/record-agent-spawn.js runs/<DELIVERY_ID>/workflow-state.json <SPAWN_REQUEST_ID> <AGENT_ID>
```

This writes `agent_dispatch.leases[]`, which prevents another agent from taking
the same task.

## Parallelism Rules

Parallelism is allowed across lanes:

- Frontend dev and backend dev may run together.
- Frontend test and backend test may run together when dependencies are met.

Parallelism is not allowed inside the same role when it would violate WIP=1.

The planner refuses automatic dispatch when write scopes overlap or are missing.
Missing write scope means the work must stay serialized until Project Manager
updates the task graph.

## Agent Boundary

Role agents may update their assigned task evidence and artifacts. They must not
move top-level workflow state. The orchestrator owns:

- State transitions
- Agent spawning
- Lease recording
- Contract checks
- Scope checks
- Final integration decisions
