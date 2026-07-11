# DevCircuit setup and operating tutorial

This guide takes a machine from empty prerequisites to concurrent, supervised deliveries. DevCircuit intentionally refuses to start when required infrastructure or credentials are missing.

## 1. Understand the processes

Run these as separate trusted controller processes:

1. `monitor.js` audits all run states and maintains the transition heartbeat.
2. One `orchestrator.js` process per delivery advances exactly one task at a time.
3. The configured runtime adapter starts isolated planner/implementer/reviewer/gatekeeper/merger sessions.
4. The configured sandbox runner places every planner, worker, and repository command in a container, VM, or distinct OS security principal.

Workers never receive Linear credentials, GitHub controller credentials, or `DEVCIRCUIT_STATE_KEY`. They return scoped messages through the capability inbox.

## 2. Installation and ownership

| Requirement | Required | Who installs or authorizes it? | May the agent install it? |
|---|---:|---|---|
| Node.js 20+ | Yes | Human/platform administrator | Only when the user explicitly authorizes system-level installation |
| Git | Yes | Human/platform administrator | Same restriction |
| GitHub CLI (`gh`) | Yes | Human/platform administrator | The agent may suggest commands; authentication remains human/admin-owned |
| Docker, Podman, VM runner, or isolated OS principal | Yes | Security/platform administrator | No autonomous installation or privilege grants |
| DevCircuit sandbox-runner wrapper | Yes | Security/platform administrator | Agent may implement the wrapper; a human must review and approve its isolation/mount policy |
| Linear credential/OAuth app | Yes | Linear workspace administrator | No; agents must not mint or expose workspace credentials |
| GitHub App, repository installation, and ruleset | Yes | GitHub organization/repository administrator | No; these are external authority changes |
| Claude Code, OpenCode, or Kilo Code | One runtime is needed | Human installs and authenticates the selected runtime | Agent may generate project-local adapter/config files after approval |
| Target repository dependencies | Per project | Normally the agent through the sandbox | Yes, if declared by the repository and network/package installation is authorized |

DevCircuit itself has no third-party npm dependencies.

## 3. Generate controller secrets

Store secrets in a secret manager or a controller-only environment file outside source control:

```bash
export DEVCIRCUIT_STATE_KEY="$(openssl rand -hex 32)"
export DEVCIRCUIT_SANDBOX_RUNNER=/absolute/path/to/devcircuit-sandbox-runner
export DEVCIRCUIT_SANDBOX_RUNNER_SHA256="$(shasum -a 256 "$DEVCIRCUIT_SANDBOX_RUNNER" | awk '{print $1}')"
export DEVCIRCUIT_AGENT_ADAPTER=/absolute/path/to/runtime-adapter
export DEVCIRCUIT_PLANNER_ADAPTER=/absolute/path/to/planner-adapter
```

The sandbox runner contract is:

```text
runner --cwd <target-worktree> --home <ephemeral-home> -- <executable> [args...]
```

It must implement `runner --self-test --nonce <random>` and print exactly one JSON object. Readiness verifies the human-approved executable SHA-256, executable bit, returned nonce, schema `devcircuit.sandbox-self-test/v1`, `status: "pass"`, an operational backend, and true assertions for process/filesystem namespaces, ephemeral HOME, mount allowlist, network policy, secret exclusion, and Docker-socket absence. A CLI version check alone is not accepted.

The runner must provide a fresh filesystem/process namespace, mount only the task worktree plus the specific context/inbox paths, use a new HOME, set resource/network limits, and never mount the controller home, Docker socket, SSH directory, GitHub config, or state-key environment.

## 4. Configure GitHub

### Evaluation-only setup

For a private local evaluation, authenticate GitHub CLI interactively:

```bash
gh auth login
gh auth status
```

Do not use a personal token for unattended production merging.

### Production setup

Create and install a dedicated GitHub App or bot identity on only the required repositories. Grant the minimum repository permissions needed by the implemented workflow:

- Metadata: read
- Contents: read/write for feature branches
- Pull requests: read/write for creation, review, and merge
- Commit statuses/checks: write for `devcircuit/gate`
- Actions/check runs: read

Provide its short-lived installation token to the trusted controller as `GH_TOKEN`. Set:

```bash
export DEVCIRCUIT_GATE_ACTOR='your-app-slug[bot]'
export DEVCIRCUIT_POST_MERGE_CHECKS='build,test,e2e'
```

Configure a ruleset on the protected base branch:

- Require pull requests; prohibit direct pushes.
- Require at least one approving review.
- Dismiss stale approvals and require approval of the latest reviewable push.
- Require resolved review conversations.
- Require build, test, security, and applicable E2E checks.
- Require `devcircuit/gate` and restrict its expected source to the dedicated App.
- Block force pushes and deletions.
- Apply rules to administrators and disallow bypass, except a separately audited emergency process.
- Use merge queue when several repositories or teams merge frequently.

DevCircuit verifies the PR head SHA, base branch, repository boundary, GitHub review, required checks, gate publisher identity, and then uses `--match-head-commit` for atomic merge protection. GitHub documents the relevant branch protections in [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## 5. Configure Linear

The selected team must contain statuses named exactly:

```text
Todo
In Progress
In Review
Done
```

For a single-developer local evaluation, create a personal API key and expose it only to the controller:

```bash
export LINEAR_API_KEY=<secret>
```

For shared or production use, create a private Linear OAuth application and install it as an application actor with `actor=app`. Request `read` and the minimum write scopes needed to create/update projects, documents, and issues; do not request `admin` unless an admin-only operation is genuinely required. Linear recommends OAuth for applications and supports app actors specifically for agents/service accounts: [OAuth 2.0](https://linear.app/developers/oauth-2-0-authentication), [OAuth actor authorization](https://linear.app/developers/oauth-actor-authorization), and [Agents setup](https://linear.app/developers/agents).

Record the Linear team ID used by `intake --team-id`. Keep OAuth client secrets and refresh tokens in the controller secret manager. If using webhooks later, validate signatures and configure a public HTTPS endpoint; never expose a localhost callback as a production webhook.

## 6. Run readiness before every new delivery

```bash
cd dev-circuit
npm run readiness -- \
  --repo /absolute/path/to/product-repository \
  --github-repository owner/repository \
  --base-branch main
```

Add `--json` for automation or `--local-only` to diagnose local tools without making remote calls. Required failures exit non-zero. The report says whether the agent may handle a fix or a human/admin must install or authorize it.

`intake` and `orchestrator` run the readiness audit automatically and fail closed.

## 7. Connect an agent runtime

DevCircuit is runtime-neutral, but support means **an adapter must implement the lease and submission protocols**. It does not treat a CLI binary merely existing as safe integration.

See [runtime adapters](runtime-adapters.md). Select exactly one initial runtime, validate it in the sandbox, and set its adapter paths. Planner and worker adapters may be different.

## 8. Start a delivery

Write the unmodified request to a file, then start intake:

```bash
node scripts/dev-circuit.js intake \
  --run SHOP-SEARCH-001 \
  --title "Product search" \
  --summary "Add verified search behavior" \
  --project-key shop-search-v1 \
  --team-id <LINEAR_TEAM_ID> \
  --github-repo owner/repository \
  --base-branch main \
  --repo /absolute/path/to/product-repository \
  --request-file /absolute/path/to/request.txt \
  --planner-adapter "$DEVCIRCUIT_PLANNER_ADAPTER"
```

Start the monitor once for the harness installation:

```bash
npm run monitor
```

Start one orchestrator for the delivery:

```bash
node scripts/orchestrator.js \
  --watch \
  --state runs/SHOP-SEARCH-001/workflow-state.json \
  --repo /absolute/path/to/product-repository \
  --adapter "$DEVCIRCUIT_AGENT_ADAPTER"
```

The orchestrator creates an isolated Git worktree before dispatching the implementer, so the agent context contains the correct workspace. It then waits for capability submissions, runs contracted checks itself, creates the PR, dispatches a separate reviewer, loops failure to a fresh implementation lease, gates, merges, and verifies the merge commit.

## 9. Concurrent projects and sessions

Concurrent deliveries are supported with these boundaries:

- Every delivery has a unique `run.id` and `runs/<RUN_ID>/workflow-state.json`.
- The monitor audits all run directories.
- Each delivery runs its own orchestrator process and durable controller lock.
- Every task uses a branch containing the run ID and a separate Git worktree under that run directory.
- WIP=1 applies **inside each delivery** through post-merge verification.
- GitHub branch protection/merge queue arbitrates final integration across deliveries.
- Linear and GitHub rate limits are shared external resources; use backoff and avoid starting unbounded numbers of runs.

Example:

```bash
node scripts/orchestrator.js --watch --state runs/PROJECT-A/workflow-state.json --repo /repos/product --adapter "$DEVCIRCUIT_AGENT_ADAPTER" &
node scripts/orchestrator.js --watch --state runs/PROJECT-B/workflow-state.json --repo /repos/product --adapter "$DEVCIRCUIT_AGENT_ADAPTER" &
```

Do not point two orchestrators at the same state file. The controller lock rejects that configuration, but it is still an operator error. Set host-level CPU/memory/concurrency limits in the sandbox runner. Linear documents API rate limits, which are shared per user/app actor: [Linear rate limiting](https://linear.app/developers/rate-limiting).

## 10. Change requests

DevCircuit accepts revisions only at a safe planning boundary:

```bash
node scripts/dev-circuit.js change-request \
  --state runs/SHOP-SEARCH-001/workflow-state.json \
  --request-file /absolute/path/to/change-request.txt \
  --planner-adapter "$DEVCIRCUIT_PLANNER_ADAPTER"
```

Historical specifications and post-merge-verified tasks remain preserved. An active implementation/review/merge must finish or be explicitly resolved before replanning.

## 11. Operational checks

```bash
node scripts/dev-circuit.js status --state runs/SHOP-SEARCH-001/workflow-state.json
npm run monitor:once
npm run validate
```

Never edit workflow JSON manually, reuse a worker capability, disable branch rules, or mark a missing test “passed.” Missing evidence remains a denial.
