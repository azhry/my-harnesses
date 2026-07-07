# Task Breakdown Template

Record tasks first, then create/update Linear:

```bash
node scripts/record-task-breakdown.js runs/<DELIVERY_ID>/workflow-state.json --file runs/<DELIVERY_ID>/task-breakdown.json --dependencies-checked
node scripts/sync-linear-task.js runs/<DELIVERY_ID>/workflow-state.json --create
```

`task-breakdown.json` should be:

```json
{
  "tasks": [
    {
      "id": "FE-001",
      "title": "Short task title",
      "lane": "frontend",
      "role": "frontend_dev",
      "depends_on": [],
      "description": "What this task changes and why.",
      "expected_changes": ["frontend/path"],
      "scope": {
        "allowed_paths": ["frontend/path/**"],
        "allowed_repos": ["project"],
        "allowed_services": ["frontend"],
        "contract_refs": []
      },
      "definition_of_done": ["Done condition"],
      "verification": ["Test or check to run"],
      "expected_mr_description": "Use templates/pull-request-template.md and include scope, tests, MR comment, checks, and merge evidence."
    }
  ]
}
```

# Linear Task Body Template

Use this content as the body for each Linear task created during
`task_breakdown`.

## Description

What this task changes and why.

## Lane

`frontend` or `backend`

## Role

`frontend_dev`, `frontend_test`, `backend_dev`, or `backend_test`

## Scope

- repos:
- allowed paths:
- out of scope:

## Dependencies

- blocks:
- depends on:

## Definition Of Done

- 

## Verification / Test Plan

- command:
- expected result:
- evidence to record:

## MR Description

Use `templates/pull-request-template.md`.

## MR Comment Required

After test/review, comment on the MR:

```text
Status: passed|failed
Task: <TASK_ID>
Evidence: <test output / failure summary>
```
