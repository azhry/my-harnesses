# Task Breakdown

Delivery: `<DELIVERY_ID>` - `<TITLE>`

> Linear fallback. When `LINEAR_API_KEY` is configured, skip this file and
> create tasks directly in Linear via `sync-linear-task.js --create`. Use
> this template only when Linear is unavailable.

> Task names: plain descriptions only, no RUN CODE prefixes. Write "[FE-001] Implement login"
> not "RUN CODE: Implement login" or "FEATURE: Implement login". The task ID
> (FE-001, BE-002) already identifies the role and sequence.

## Task Graph Summary

- Frontend required:
- Backend required:
- Dependencies checked:

## Approved Scope Baseline

| Type | Values |
| --- | --- |
| Task IDs |  |
| Repos |  |
| Services |  |
| Paths / Globs |  |
| API Contracts |  |

## Git Policy

| Field | Value |
| --- | --- |
| Base branch | `main` |
| Feature branch pattern | `delivery/<DELIVERY_ID>/<TASK_ID>` |
| Push timing | After matching tests pass |
| Merge request target | `main` |
| Auto-merge | Enabled by default after merge checks pass unless explicitly disabled |

## Contract Baseline

| ID | Kind | Producer Task | Consumer Task | Expected Fields |
| --- | --- | --- | --- | --- |
| CONTRACT-001 | api_payload | BE-001 | FE-001 | `field_name:string:required` |

## Frontend Implementation Tasks

| ID | Task | Description | Acceptance Criteria | Depends On | Feature Branch | Allowed Paths | Contract Refs | Definition Of Done | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FE-001 |  |  |  |  | `delivery/<DELIVERY_ID>/FE-001` |  |  |  |  |

## Frontend Test Tasks

| ID | Task | Covers | Command / Method |
| --- | --- | --- | --- |
| FET-001 |  | FE-001 |  |

## Backend Implementation Tasks

| ID | Task | Depends On | Feature Branch | Allowed Paths | Contract Refs | Definition Of Done | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BE-001 |  |  | `delivery/<DELIVERY_ID>/BE-001` |  |  |  |  |

## Backend Test Tasks

| ID | Task | Covers | Command / Method |
| --- | --- | --- | --- |
| BET-001 |  | BE-001 |  |

## Integration Tasks

| ID | Task | Depends On | Evidence |
| --- | --- | --- | --- |
| INT-001 |  |  |  |

## Risks / Blockers

- 
