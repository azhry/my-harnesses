# Measurement

The harness measures two different failure modes:

| Measurement | Meaning |
| --- | --- |
| Contract mismatch | Approved contracts disagree with actual producer/consumer behavior |
| Scope issue | Actual changes fall outside approved tasks, paths, services, repos, or contracts |

Do not rely only on model judgment for these checks. The scripts below compare
structured state:

```bash
node scripts/check-contracts.js runs/<DELIVERY_ID>/workflow-state.json
node scripts/check-scope.js runs/<DELIVERY_ID>/workflow-state.json
```

## Contract Mismatch

Contract checks compare:

- `contracts.interfaces[].expected_fields`
- `contracts.interfaces[].actual_producer_fields`
- `contracts.interfaces[].actual_consumer_fields`

Example:

```json
{
  "id": "api-cancellation-reason",
  "kind": "api_payload",
  "producer_task_id": "BE-001",
  "consumer_task_id": "FE-001",
  "expected_fields": [
    { "name": "reason_code", "type": "string", "required": true }
  ],
  "actual_producer_fields": [
    { "name": "reason_code", "type": "string", "required": true }
  ],
  "actual_consumer_fields": [
    { "name": "cancelReason", "type": "string", "required": true }
  ]
}
```

This fails because the consumer sends `cancelReason`, while the approved
contract and backend producer expect `reason_code`.

Results are written to:

```json
{
  "integration": {
    "contract_checks": []
  }
}
```

## Scope Issue

Scope checks compare actual changed paths against:

- `implementation.approved_scope.paths`
- `implementation.approved_scope.task_ids`
- `task_graph.tasks[].scope.allowed_paths`

Actual changes can be recorded directly:

```json
{
  "implementation": {
    "actual_changes": [
      {
        "path": "frontend/src/cancellations/ReasonSelector.tsx",
        "repo": "web",
        "service": "frontend",
        "task_id": "FE-001",
        "change_type": "added",
        "evidence": ["git diff --name-only"]
      }
    ]
  }
}
```

Or derived from each task's `implementation.changed_files[]`.

Results are written to:

```json
{
  "integration": {
    "scope_checks": []
  }
}
```

## Final Review Rule

The validator blocks `waiting_for_final_review` when either of these contains
failed or blocked checks:

- `integration.contract_checks[]`
- `integration.scope_checks[]`

Borderline cases should be routed to Product Manager or Project Manager and
approved explicitly before final review.
