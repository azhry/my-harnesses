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

Real run state is sealed after trusted script writes. If the seal is missing or
broken, do not continue the run; repair the state intentionally, then reseal it
with `seal-state.js`. The repair sealer first runs validation against the
repaired data and refuses to bless a state that still has workflow errors.

## Implementation

Frontend and backend lanes run in parallel when scopes do not overlap.

```text
frontend_dev -> frontend_test(record-test-results) -> submit-task(push/MR/comment/checks/merge)
backend_dev  -> backend_test(record-test-results)  -> submit-task(push/MR/comment/checks/merge)
```

Dev and test must be separate `agent-spec-*` OpenCode agents. Test failure
returns to dev. A loop that reaches 3 attempts requires user intervention.
Each task needs its own MR; shared task MRs are rejected.
MRs must not be merged until code-host checks pass, and dev-task MR check/merge
evidence must come from `submit-task.js`.

Test agents use bounded task-scoped commands. On timeout, hang, or first failing
run, record failed evidence and return to dev instead of rerunning full suites.
