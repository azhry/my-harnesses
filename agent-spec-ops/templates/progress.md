# Session Progress: <DELIVERY_ID>

Track what's been done and what's next. Update this after every action.

## Progress Checklist

- [ ] **Tool readiness**: Product tracker (<TRACKER>) and code host (<HOST>) chosen and verified
- [ ] **Tool readiness gate**: Presented to human, approved
- [ ] **Knowledge discovery**: Findings recorded, gaps identified
- [ ] **Product requirements**: Written, saved to `runs/<DELIVERY_ID>/product-requirements.md`
- [ ] **Stitch prompt**: Written using `templates/stitch-ui-prompt.md`
- [ ] **Design stitch gate**: Presented to human, approved with Stitch project ID
- [ ] **Design assembly**: Screens fetched, saved to `runs/<DELIVERY_ID>/design-assets/`
- [ ] **System rules**: Derived from design assets
- [ ] **Product review gate**: Instructions written, presented to human, approved
- [ ] **Task breakdown**: PM created tasks with DoD, AC, expected_changes, verification
- [ ] **Linear sync**: Tasks created in Linear (`sync-linear-task.js --create`)
- [ ] **Delivery plan review gate**: Instructions written, presented to human, approved
- [ ] **Implementation**: Tasks implemented per scope
- [ ] **Test results**: Recorded via `record-test-results.js`
- [ ] **Token usage**: Recorded via `record-token-usage.js`
- [ ] **Git flow**: Branch created, committed, pushed, PR created with full description
- [ ] **Git lifecycle enforcement**: `enforce-git-lifecycle.js` passed
- [ ] **Tasks verified**: All tasks moved to `verified` via `transition-task.js`
- [ ] **Integration verification**: Contract/scope checks, docker compose test
- [ ] **Knowledge improvement**: Cards promoted, synced to Linear
- [ ] **Final review gate**: Instructions written, presented to human, approved

## Current State

- **Top-level state**: <STATE>
- **Active task**: <TASK_ID>
- **Gate waiting**: <GATE_NAME> (if any)
- **Blockers**: <BLOCKER_DESCRIPTION>

## Current Token Totals

- **Total tokens**: <N>
- **Total cost**: $<N>
- **Last recorded**: <DATE>

## Notes

-
