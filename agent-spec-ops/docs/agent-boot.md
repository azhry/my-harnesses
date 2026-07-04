# Agent Boot

Run:

```bash
node scripts/read-context.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
node scripts/read-instructions.js runs/<DELIVERY_ID>/workflow-state.json --role <ROLE>
```

Then act only through the legal next states printed by `read-instructions.js`.

Rules:

- Do not edit state status fields by hand.
- Do not implement before `implementation_in_progress`.
- Rework requests go to `task_breakdown`.
- Dev and test are separate agents.
- Frontend and backend may run in parallel.
- If a dev/test loop reaches 3 attempts, stop and ask the user to intervene.
