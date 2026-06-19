# Verification

Done means verified, not merely implemented.

## Verification Levels

| Level | Applies To | Evidence |
| --- | --- | --- |
| Static | Types, lint, build checks | Command, status, timestamp |
| Unit | Backend functions, UI utilities, small components | Test command and result |
| Integration | API/service boundaries, data flows, frontend/backend contract | Test command, env notes, result |
| UI behavior | User interaction and visible states | Test result, screenshot, story, or manual evidence |
| Acceptance | Product criteria | Criterion-to-evidence mapping |

## Task Verification

Every task should declare:

- Expected verification command or method
- Evidence required
- Acceptance criteria covered
- Knowledge findings used

Implementation tasks are not complete until the matching test role has passed or
the test is explicitly waived with an approval note.

## Integration Verification

The orchestrator checks:

- Frontend calls match backend/API contracts.
- UI rules match implemented states and error behavior.
- Backend rules match product acceptance criteria.
- Tests cover critical accepted behavior.
- Deviations are either approved or routed back to planning/product.

Run deterministic measurement before final review:

```bash
node scripts/check-contracts.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/check-scope.js runs/<DELIVERY_ID>/workflow-state.json
```

Do not enter `waiting_for_final_review` while any contract or scope check is
failed or blocked.

For every frontend/backend dev task, also verify:

- `git_flow.base_branch` is `main`.
- `git_flow.target_branch` is `main`.
- `git_flow.branch_created` has evidence before active implementation.
- `git_flow.local_tests_passed` has evidence before push/MR.
- `git_flow.pushed` has evidence.
- `git_flow.merge_request_url` targets `main`.
- `git_flow.merge_checks_passed` has evidence before merge.
- `git_flow.merged` has evidence when auto-merge is enabled.

## Final Handoff

The final handoff should include:

- Product summary
- Approved scope
- Changed areas
- Verification commands and results
- Known risks
- Follow-up tasks
- Knowledge updates worth reusing
