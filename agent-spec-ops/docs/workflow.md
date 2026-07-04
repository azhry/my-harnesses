# Workflow

```text
intake -> tool_readiness -> knowledge_discovery -> product_requirements
-> product_review -> design_assembly -> system_rules -> system_rules_review
-> task_breakdown -> implementation_in_progress -> implementation_review -> done
```

## Gates

| Gate | Pass | Fail |
| --- | --- | --- |
| `product_review` | `design_assembly` | `knowledge_discovery` |
| `system_rules_review` | `task_breakdown` | `design_assembly` |
| `implementation_review` | `done` | `implementation_in_progress` |

Human rework always routes to `task_breakdown`.

## Implementation

Frontend and backend lanes run in parallel when scopes do not overlap.

```text
frontend_dev -> frontend_test -> push -> MR -> MR comment -> merge
backend_dev  -> backend_test  -> push -> MR -> MR comment -> merge
```

Dev and test must be separate agents. Test failure returns to dev. A loop that
reaches 3 attempts requires user intervention.
