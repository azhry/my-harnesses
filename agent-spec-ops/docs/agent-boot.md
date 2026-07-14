# Agent Boot

Run:

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
```

Then act only through the legal next states printed by `read-instructions.js`.

Rules:

- Do not edit state status fields by hand.
- If the user provides Linear/GitHub credentials, immediately store them with
  `record-run-secrets.js` in the run secret env file. Do not put raw values in
  workflow state, events, logs, docs, or status messages.
- Do not implement before `implementation_in_progress`.
- Before editing task files, run `check-write-scope.js` with the assigned role
  and `--agent-id` set to your current Codex/OpenCode session id. Stop if the
  lease is missing, expired, or superseded.
- Rework requests go to `task_breakdown`.
- Dev and test are separate agents.
- Frontend and backend may run in parallel.
- If a dev/test loop reaches 3 attempts, stop and ask the user to intervene.
