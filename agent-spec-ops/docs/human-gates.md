# Human Gates

The compact harness has three human gates.

| Gate | Review | If Passed | If Not Passed |
| --- | --- | --- | --- |
| `product_review` | Product requirements | `design_assembly` | `knowledge_discovery` |
| `system_rules_review` | System rules and design fit | `task_breakdown` | `design_assembly` |
| `implementation_review` | Result against product requirements | `done` | `implementation_in_progress` |

If the user requests rework instead of a direct implementation fix, route to
`task_breakdown`.

Gate approval must record:

- status
- approver
- approval note
- timestamp
- evidence
