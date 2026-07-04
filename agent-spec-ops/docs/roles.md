# Roles

| Role | Owns |
| --- | --- |
| `product_manager` | product requirements and acceptance criteria |
| `project_manager` | Linear task breakdown, dependencies, task template quality |
| `frontend_dev` | frontend implementation only |
| `frontend_test` | frontend verification and MR pass/fail comment |
| `backend_dev` | backend implementation only |
| `backend_test` | backend verification and MR pass/fail comment |
| `orchestrator` | state transitions, gates, subagent dispatch, rework routing |

Dev agents do not approve their own work. Test agents record passed/failed
evidence and comment on the MR.
