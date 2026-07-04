## Summary

<1-3 sentences describing what this PR does at a high level.>

## Task

- **Delivery:** <DELIVERY_ID>
- **Task:** <TASK_ID>
- **Description:** <task.description from workflow-state>
- **Product requirement(s):** <requirement IDs or links>

## Changes

- <file path>: <what changed and why>
- <file path>: <what changed and why>

## Impact

- **System:** <Frontend / Backend / Both>
- **Breaking:** Yes / No
- **Dependencies:** <new or changed dependencies>
- **Configuration:** <new env vars, config changes>

## Manual Test Instructions

1. <step-by-step instructions to verify the change>
2. <include specific commands, URLs, payloads>

## Test Agent Comment

The test/review agent must add an MR comment:

```text
Status: passed|failed
Task: <TASK_ID>
Evidence: <test command/output or failure summary>
```

After a passed status comment, merge this task MR unless code-host policy blocks it.
The task cannot be marked `verified` until merged MR evidence and the merge commit
are recorded in the harness state.

## Related

- Closes <TASK_ID>
- Related MRs/Issues: <links>
