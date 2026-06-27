# Agent Boot Packet

Read this packet after `read-context.js` and before acting.

## Non-Negotiables

- Run `read-context.js` after compaction, interruption, role handoff, or stale-context rejection.
- Use `workflow-state.json` as the operational record; do not rely on chat memory.
- Use Linear for task management and knowledge sync when policy requires it.
- Store raw keys only in environment variables. State may store only safe metadata.
- Long-lived local credentials may live in `.agent-spec-ops.secrets.env`; that file is gitignored and auto-loaded by harness scripts.
- Use transition scripts for state and task status changes.
- Use `compact-state.js` when `workflow-state.json` becomes noisy.

## Commands

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
node scripts/transition.js runs/<DELIVERY_ID>/workflow-state.json <STATE> "reason"
node scripts/transition-task.js runs/<DELIVERY_ID>/workflow-state.json <TASK_ID> <STATUS> "reason"
node scripts/compact-state.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/validate-harness.js
```

## Read More Only When Needed

- State transition criteria: `docs/state-transitions.md`
- Role details: `docs/role-<ROLE>.md`
- Git lifecycle: `docs/git-lifecycle.md`
- Verification: `docs/verification.md`
- Linear sync: `docs/linear-sync.md`
