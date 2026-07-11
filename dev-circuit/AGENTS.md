# DevCircuit agent rules

DevCircuit is a closed-loop software engineering harness. Never bypass its state writers or edit files under `runs/` by hand.

## Required behavior

1. Analyze the request and produce a versioned specification and task plan before implementation.
2. Work on exactly one task at a time.
3. Use a dedicated feature branch for every task.
4. Keep implementer, reviewer, gatekeeper, and merger identities separate.
5. Treat claims as untrusted. Record commands, exit codes, timestamps, artifacts, and exact Git SHAs.
6. A task follows Linear `Todo -> In Progress -> In Review -> Done`.
7. A failed review returns the same task to `In Progress`; resubmission returns it to `In Review`.
8. A passed independent review sets Linear to `Done`, but merge still requires the deterministic gate.
9. Any new commit invalidates prior review and gate decisions.
10. Missing, stale, contradictory, or unverifiable evidence is a denial.

## Commands

Use `node scripts/dev-circuit.js help`. Run `npm run validate` before handing off harness changes.

The continuous monitor must be started before a live delivery:

```bash
npm run monitor
```

The monitor is a durable supervisor, not an implementer. It may audit and deny transitions; it may never write product code or approve its own work.
