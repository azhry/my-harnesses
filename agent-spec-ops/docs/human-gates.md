# Human Gates

The compact harness has three human gates.

| Gate | Review | If Passed | If Not Passed |
| --- | --- | --- | --- |
| `product_review` | Product requirements | `design_assembly` | `knowledge_discovery` |
| `system_rules_review` | System rules and design fit | `task_breakdown` | `design_assembly` |
| `implementation_review` | Result against product requirements | `done` | `implementation_in_progress` |

If the user requests rework instead of a direct implementation fix, route to
`task_breakdown`.

Approval of `implementation_review` means the current delivery slice was
reviewed. It does not authorize declaring the whole project complete or setting
a Linear project to Completed. Closing the delivery requires a separate explicit
completion approval recorded with `record-completion-approval.js`.

Gate approval must record:

- status
- approver
- approval note
- timestamp
- evidence
