"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function command(name, args = ["--version"]) {
  const result = spawnSync(name, args, { encoding: "utf8", timeout: 10000 });
  return { available: !result.error && result.status === 0, detail: result.error ? result.error.message : `${result.stdout || result.stderr}`.trim().split("\n")[0] };
}

function item(id, required, ok, detail, owner, fix) {
  return { id, required, status: ok ? "ready" : required ? "blocked" : "optional_missing", detail, installation_owner: owner, fix };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function verifySandboxRunner(runner, approvedDigest) {
  if (!runner || !fs.existsSync(runner)) return { available: false, detail: "runner missing" };
  let stat;
  try { stat = fs.statSync(runner); } catch (error) { return { available: false, detail: error.message }; }
  if (!stat.isFile() || (stat.mode & 0o111) === 0) return { available: false, detail: "runner is not an executable file" };
  if (!/^[a-f0-9]{64}$/i.test(approvedDigest || "")) return { available: false, detail: "approved SHA-256 is missing or invalid" };
  const actualDigest = sha256(runner);
  if (!crypto.timingSafeEqual(Buffer.from(actualDigest, "hex"), Buffer.from(approvedDigest, "hex"))) {
    return { available: false, detail: `runner SHA-256 mismatch (${actualDigest})` };
  }
  const nonce = crypto.randomBytes(24).toString("hex");
  const result = spawnSync(runner, ["--self-test", "--nonce", nonce], { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH || "" } });
  if (result.error || result.status !== 0) return { available: false, detail: result.error ? result.error.message : `self-test exited ${result.status}` };
  let attestation;
  try { attestation = JSON.parse(result.stdout); } catch { return { available: false, detail: "self-test did not return one JSON attestation" }; }
  const isolation = attestation && attestation.isolation;
  const valid = attestation.schema === "devcircuit.sandbox-self-test/v1" &&
    attestation.nonce === nonce && attestation.status === "pass" &&
    attestation.backend && attestation.backend.operational === true &&
    isolation && isolation.process_namespace === true && isolation.filesystem_namespace === true &&
    isolation.ephemeral_home === true && isolation.mount_allowlist === true &&
    isolation.network_policy === true && isolation.secret_exclusion === true &&
    isolation.docker_socket_absent === true;
  return { available: Boolean(valid), detail: valid ? `approved runner ${actualDigest}; backend ${attestation.backend.name}` : "self-test attestation is incomplete, stale, or not nonce-bound" };
}

function localChecks(options = {}) {
  const node = command("node", ["--version"]);
  const major = node.available ? Number(node.detail.replace(/^v/, "").split(".")[0]) : 0;
  const git = command("git", ["--version"]);
  const gh = command("gh", ["--version"]);
  const docker = command("docker", ["--version"]);
  const podman = command("podman", ["--version"]);
  const sandboxRunner = process.env.DEVCIRCUIT_SANDBOX_RUNNER;
  const sandboxSelfTest = verifySandboxRunner(sandboxRunner, process.env.DEVCIRCUIT_SANDBOX_RUNNER_SHA256);
  const agentAdapter = process.env.DEVCIRCUIT_AGENT_ADAPTER;
  const plannerAdapter = process.env.DEVCIRCUIT_PLANNER_ADAPTER;
  const checks = [
    item("tool.node", true, node.available && major >= 20, node.detail || "missing", "human", "Install Node.js 20+ using your approved system/version manager."),
    item("tool.git", true, git.available, git.detail || "missing", "human", "Install Git using the operating-system package manager."),
    item("tool.gh", true, gh.available, gh.detail || "missing", "human", "Install GitHub CLI, then authenticate interactively with gh auth login."),
    item("tool.container", true, docker.available || podman.available, docker.available ? docker.detail : podman.available ? podman.detail : "Docker or Podman missing", "human", "Install and approve Docker/Podman, then configure a DevCircuit sandbox runner."),
    item("tool.claude", false, command("claude", ["--version"]).available, "Claude Code adapter option", "human", "Install/authenticate Claude Code only if using its adapter."),
    item("tool.opencode", false, command("opencode", ["--version"]).available, "OpenCode adapter option", "human", "Install/authenticate OpenCode only if using its adapter."),
    item("tool.kilo", false, command("kilo", ["--version"]).available, "Kilo Code adapter option", "human", "Install @kilocode/cli and run /connect only if using its adapter."),
    item("config.state_key", true, String(process.env.DEVCIRCUIT_STATE_KEY || "").length >= 32, "Controller HMAC key", "human", "Generate a 32+ character random secret in the controller secret manager; never expose it to workers."),
    item("config.sandbox_runner", true, sandboxSelfTest.available, sandboxRunner || "missing", "human", "Provision an executable trusted runner and pin its SHA-256 in DEVCIRCUIT_SANDBOX_RUNNER_SHA256."),
    item("config.sandbox_self_test", true, sandboxSelfTest.available, sandboxSelfTest.detail || "failed", "human", "The trusted runner must pass --self-test and prove isolation/mount/network policy."),
    item("config.agent_adapter", true, Boolean(agentAdapter && fs.existsSync(agentAdapter)), agentAdapter || "missing", "human", "Install and certify a Claude Code, OpenCode, Kilo Code, or other runtime adapter."),
    item("config.planner_adapter", true, Boolean(plannerAdapter && fs.existsSync(plannerAdapter)), plannerAdapter || "missing", "human", "Install and certify the planner adapter."),
    item("config.linear_token", true, Boolean(process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN), "Linear credential presence only; value not printed", "human", "Create a personal API key for local evaluation or install a Linear OAuth app for shared use."),
    item("config.gate_actor", true, Boolean(process.env.DEVCIRCUIT_GATE_ACTOR), process.env.DEVCIRCUIT_GATE_ACTOR || "missing", "human", "Configure the dedicated GitHub App/bot login allowed to publish devcircuit/gate."),
    item("config.post_merge_checks", true, Boolean(process.env.DEVCIRCUIT_POST_MERGE_CHECKS), process.env.DEVCIRCUIT_POST_MERGE_CHECKS || "missing", "human", "List the required base-branch check-run names in DEVCIRCUIT_POST_MERGE_CHECKS.")
  ];
  if (options.repo) {
    const repo = path.resolve(options.repo);
    const isRepo = command("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"]);
    checks.push(item("project.git_repository", true, isRepo.available && isRepo.detail === "true", repo, "agent", "Point --repo to a valid Git checkout. The agent may inspect but must not initialize an unrelated repository."));
  }
  return checks;
}

async function remoteChecks(options = {}) {
  const checks = [];
  const auth = command("gh", ["auth", "status"]);
  checks.push(item("github.authentication", true, auth.available, auth.detail || "not authenticated", "human", "Run gh auth login using the dedicated GitHub App/bot or approved account."));
  if (auth.available && options.githubRepository) {
    const repoView = command("gh", ["repo", "view", options.githubRepository, "--json", "nameWithOwner,defaultBranchRef"]);
    checks.push(item("github.repository_access", true, repoView.available, repoView.detail || "unavailable", "human", "Grant the GitHub App access to this repository."));
    const protectionResult = spawnSync("gh", ["api", `repos/${options.githubRepository}/branches/${options.baseBranch || "main"}/protection`], { encoding: "utf8", timeout: 10000 });
    let protection = null;
    try { if (protectionResult.status === 0) protection = JSON.parse(protectionResult.stdout); } catch {}
    const contexts = protection && protection.required_status_checks && protection.required_status_checks.contexts || [];
    const reviews = protection && protection.required_pull_request_reviews;
    checks.push(item("github.branch_protection", true, Boolean(protection), protection ? "Protection API accessible" : `${protectionResult.stderr || "unavailable"}`.trim(), "human", "Enable protected-branch or equivalent ruleset protection."));
    checks.push(item("github.required_review", true, Boolean(reviews && reviews.required_approving_review_count >= 1 && reviews.dismiss_stale_reviews), reviews ? `approvals=${reviews.required_approving_review_count}, dismiss_stale=${reviews.dismiss_stale_reviews}` : "missing", "human", "Require approval and dismiss stale reviews."));
    checks.push(item("github.gate_required", true, contexts.includes("devcircuit/gate"), `required contexts: ${contexts.join(", ") || "none"}`, "human", "Add devcircuit/gate as a required status from the dedicated App."));
    checks.push(item("github.force_push_blocked", true, Boolean(protection && protection.allow_force_pushes && protection.allow_force_pushes.enabled === false), protection && protection.allow_force_pushes ? String(protection.allow_force_pushes.enabled) : "unknown", "human", "Disable force pushes on the protected base branch."));
  }
  const token = process.env.LINEAR_API_KEY || process.env.LINEAR_ACCESS_TOKEN;
  if (token) {
    try {
      const response = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query Readiness { viewer { id name } }" }) });
      const payload = await response.json();
      checks.push(item("linear.authentication", true, response.ok && payload.data && payload.data.viewer, response.ok ? "Linear viewer query succeeded" : `HTTP ${response.status}`, "human", "Replace/re-authorize the Linear credential."));
      if (response.ok && options.linearTeamId) {
        const stateResponse = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: "query ReadinessStates($teamId: ID!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { name } } }", variables: { teamId: options.linearTeamId } }) });
        const statePayload = await stateResponse.json();
        const names = statePayload.data && statePayload.data.workflowStates ? statePayload.data.workflowStates.nodes.map((entry) => entry.name) : [];
        const requiredNames = ["Todo", "In Progress", "In Review", "Done"];
        checks.push(item("linear.team_statuses", true, requiredNames.every((name) => names.includes(name)), `statuses: ${names.join(", ") || "unavailable"}`, "human", "Configure the selected Linear team with exact Todo, In Progress, In Review, and Done statuses."));
      }
    } catch (error) {
      checks.push(item("linear.authentication", true, false, error.message, "human", "Allow api.linear.app network access and verify the credential."));
    }
  }
  return checks;
}

async function readiness(options = {}) {
  const checks = [...localChecks(options), ...(options.remote === false ? [] : await remoteChecks(options))];
  return {
    ready: !checks.some((check) => check.required && check.status !== "ready"),
    checked_at: new Date().toISOString(),
    checks,
    policy: {
      agent_may_install: ["project-local dependencies explicitly declared by the target repository, after approval when network is required"],
      human_must_install_or_authorize: ["system runtimes and CLIs", "container/VM sandbox", "GitHub authentication/App/rulesets", "Linear credentials/OAuth app", "controller secrets"]
    }
  };
}

module.exports = { command, item, sha256, verifySandboxRunner, localChecks, remoteChecks, readiness };
