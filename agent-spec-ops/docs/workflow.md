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

`implementation_review` approves a delivered slice. It is not permission to
declare the whole product or Linear project complete. Transitioning to `done`
requires a separate explicit human completion approval recorded with
`record-completion-approval.js`. If the human later identifies remaining scope,
route `done -> task_breakdown`.

Real run state is sealed after trusted script writes. If the seal is missing or
broken, do not continue the run; repair the state intentionally, then reseal it
with `seal-state.js`. The repair sealer first runs validation against the
repaired data and refuses to bless a state that still has workflow errors.

## Run Secrets

Credentials supplied for a delivery are run-scoped secrets. Store them only in
`runs/<DELIVERY_ID>/.agent-spec-ops.secrets.env` through the helper:

```bash
node scripts/record-run-secrets.js runs/<DELIVERY_ID>/workflow-state.json --set LINEAR_API_KEY=<value>
node scripts/record-run-secrets.js runs/<DELIVERY_ID>/workflow-state.json --set GITHUB_TOKEN=<value>
```

The run secret env file is untracked, mode 0600, and automatically loaded by
harness scripts. Raw token values must not be copied into workflow state,
events, logs, docs, or final reports.

## Implementation

Frontend and backend lanes run in parallel when scopes do not overlap.

```text
frontend_dev -> frontend_test(record-test-results) -> submit-task(push/MR/comment/admin-merge if allowed)
backend_dev  -> backend_test(record-test-results)  -> submit-task(push/MR/comment/admin-merge if allowed)
```

Dev and test must be separate `agent-spec-*` OpenCode agents. Test failure
returns to dev. A loop that reaches 3 attempts requires user intervention.
Each task needs its own MR; shared task MRs are rejected.
Code-host checks and independent PR review are controlled by
`implementation.git_policy`. When `allow_same_github_account_review=true`,
`allow_admin_merge=true`, `review_required_before_merge=false`, and
`auto_merge_requires_checks=false`, `submit-task.js` may merge with the same
GitHub account and without protected merge gates. Dev-task MR merge evidence
must still come from `submit-task.js`.

Test agents use bounded task-scoped commands. On timeout, hang, or first failing
run, record failed evidence and return to dev instead of rerunning full suites.
Local browser E2E uses visible/headed mode by default so the user can watch.
Headless is only for CI, explicit user request, or final artifact-only checks.

## Session Evaluation

After a real Codex delivery run, audit the matching sessions before changing
harness behavior:

```bash
node scripts/audit-codex-sessions.js --match <PROJECT_OR_RUN_MARKER> --state runs/<DELIVERY_ID>/workflow-state.json
```

Use confirmed recurring findings to tighten scripts, prompts, or policy. Common
findings include superseded workers, STOP-after-write ordering, branch
protection blockers, raw merge attempts, duplicate completion events, and
recorded leases that cannot be found in the scanned session set.
