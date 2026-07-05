# State Transitions

Every transition requires its checklist to be true.

| Transition | Checklist |
| --- | --- |
| `intake -> tool_readiness` | Delivery id, title, request summary recorded |
| `tool_readiness -> knowledge_discovery` | Linear ready, code host ready, repo access known |
| `knowledge_discovery -> product_requirements` | Sources listed, findings recorded, gaps listed |
| `product_requirements -> product_review` | Requirements artifact ready, acceptance criteria present, source evidence linked |
| `product_review -> design_assembly` | Human approved `product_review` |
| `product_review -> knowledge_discovery` | Human requested product changes |
| `design_assembly -> system_rules` | Design assets or approved fallback recorded |
| `system_rules -> system_rules_review` | System rules artifact ready and traceable to product/design |
| `system_rules_review -> task_breakdown` | Human approved `system_rules_review` |
| `system_rules_review -> design_assembly` | Human requested design/rule changes |
| `task_breakdown -> implementation_in_progress` | Linear tasks created, task template complete, dependencies checked, multi-agent dispatch ready |
| `implementation_in_progress -> implementation_review` | All frontend/backend tasks verified, tests recorded, MR comments recorded, MR checks passed, task MRs merged, implementation mapped to requirements |
| `implementation_review -> done` | Human approved `implementation_review` |
| `implementation_review -> implementation_in_progress` | Human requested implementation fixes |
| `implementation_review -> task_breakdown` | Human requested rework or scope/task changes |

## Task Status

```text
planned -> active -> implemented -> testing -> verified
testing -> failed -> active
```

If a task reaches 3 failed dev/test attempts, stop and ask the user to intervene.
