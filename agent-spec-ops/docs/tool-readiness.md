# Tool Readiness

Tool readiness proves the harness has enough access and local tooling before it
relies on external trackers, code hosts, frontend commands, or backend commands.

## Required Choices

The orchestrator must choose one product tracker:

- `linear`
- `atlassian`

The orchestrator must choose one code host:

- `github`
- `gitlab`

Use:

```bash
node scripts/check-tool-readiness.js runs/<DELIVERY_ID>/workflow-state.json
```

The script checks environment variables first. If a required token is missing
and the script is running interactively, it prompts for a token. Tokens entered
at the prompt are used only for the current readiness result and are not written
to the state file.

## Product Tracker Environment Variables

Linear:

- `LINEAR_API_KEY`
- `LINEAR_ACCESS_TOKEN`

Atlassian:

- `ATLASSIAN_API_TOKEN`
- `ATLASSIAN_EMAIL`
- `ATLASSIAN_BASE_URL` or `ATLASSIAN_SITE_URL`

The access token is required. Email and base URL are strongly recommended for
Atlassian API readiness.

## Code Host Environment Variables

GitHub:

- `GITHUB_TOKEN`
- `GH_TOKEN`

GitLab:

- `GITLAB_TOKEN`
- `GITLAB_PAT`
- `GRAB_GITLAB_ACCESS_TOKEN`

The PAT/token is required for code host API readiness.

## Frontend Tooling

Frontend readiness checks common local commands:

- `node`
- `npm`
- `yarn`
- `pnpm`
- `npx`
- `playwright`

Ready means Node.js and at least one package manager are available. Playwright
is useful but optional because not every frontend task requires browser tests.

## Backend Tooling

Backend readiness checks common local commands:

- `go`
- `python3`
- `java`
- `mvn`
- `gradle`
- `docker`
- `cargo`

Ready means at least one backend runtime is available. Docker is reported
separately because some integration tests need it, but it is not universally
required.

## Human Gate

After the readiness script completes, the harness **must not** proceed to
`knowledge_discovery` without human acknowledgment. Present the readiness report
to the human and wait for approval. The state machine enforces this through the
`waiting_for_tool_readiness_review` state.

Use:

```bash
node scripts/transition.js runs/<DELIVERY_ID>/workflow-state.json waiting_for_tool_readiness_review "Tool readiness checked, awaiting human approval"
```

The human can `approve`, `approve_with_notes`, `request_changes`, or `block`.
If changes are requested, transition back to `tool_readiness` to re-run checks.

## State Recording

Readiness results are recorded under:

```json
{
  "tool_readiness": {
    "status": "ready",
    "choices": {
      "product_tracker": "linear",
      "code_host": "github"
    },
    "capabilities": [],
    "frontend": {},
    "backend": {}
  }
}
```

Never record raw token values in state, logs, or reports.

## Local Tracker Fallback

Linear/Jira access is useful but not required to keep the harness moving. When
the selected product tracker is missing or blocked, the readiness script records
local task fallback in `memory.local_task_provider` and uses:

```text
runs/<DELIVERY_ID>/tasks.json
```

Agents should update that file through:

```bash
node scripts/update-local-task.js runs/<DELIVERY_ID>/workflow-state.json --id <TASK_ID> --status <STATUS>
```

The local task IDs should be preserved if tasks are later synced to Linear or
Jira.
