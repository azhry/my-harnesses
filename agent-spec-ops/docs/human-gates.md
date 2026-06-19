# Human Gates

Human gates are required where the harness needs a business, product, design,
or acceptance decision. They are not required for ordinary dev/test rework.

## Gate 1: Product Review

State:

```text
waiting_for_product_review
```

Human decision options:

- `approve`
- `approve_with_notes`
- `request_changes`
- `block`

Required before approval:

- Product requirements exist.
- Acceptance criteria are testable.
- Google Stitch prompt exists.
- UI/system rules exist.
- Open questions are resolved, deferred, or marked as blockers.

Approved transition:

```text
waiting_for_product_review -> product_approved
```

Revision transition:

```text
waiting_for_product_review -> product_revision -> product_requirements
```

## Gate 2: Delivery Plan Review

State:

```text
waiting_for_delivery_plan_review
```

Human decision options:

- `approve`
- `approve_with_notes`
- `request_changes`
- `block`

Required before approval:

- Task graph exists.
- Task dependencies are checked.
- Every dev task has verification coverage.
- Definitions of done are executable.
- Risk and rollout notes are recorded when relevant.

Approved transition:

```text
waiting_for_delivery_plan_review -> delivery_plan_approved
```

Revision transition:

```text
waiting_for_delivery_plan_review -> task_revision -> task_breakdown
```

## Gate 3: Final Review

State:

```text
waiting_for_final_review
```

Human decision options:

- `approve`
- `approve_with_followups`
- `request_rework`
- `block`

Required before approval:

- Frontend lane is verified or not applicable.
- Backend lane is verified or not applicable.
- Integration verification passed.
- Acceptance criteria are mapped to evidence.
- Handoff report is prepared.

Approved transition:

```text
waiting_for_final_review -> done
```

Rework transition:

```text
waiting_for_final_review -> implementation_in_progress
```

## Why Not More Gates?

The frontend and backend dev/test loops should usually run without human
approval. A failure report is enough to send work back to the matching dev role.

Escalate to a human only when:

- The fix changes approved product scope.
- The test expectation conflicts with acceptance criteria.
- The same failure repeats past `max_attempts`.
- A source needed for accurate implementation cannot be verified.
