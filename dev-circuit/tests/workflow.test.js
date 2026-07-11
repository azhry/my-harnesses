"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { describe, it } = require("node:test");
const { execute, init } = require("../src/cli");
const { readState, writeState } = require("../src/state-store");
const { TASK_STATES, linearStatusFor, createTask, recordAgent, recordEvidence, recordReview, transitionTask } = require("../src/workflow");
const { auditMergeGate, auditState } = require("../src/gates");
const { syncLinearState } = require("../src/linear");
const { analyzeRequest } = require("../src/planner");
const { workerEnv } = require("../src/security");
const submissions = require("../src/submissions");
const github = require("../src/github");
const { localChecks, sha256, verifySandboxRunner } = require("../src/readiness");

process.env.DEVCIRCUIT_STATE_KEY = "devcircuit-test-key-0123456789abcdef";
process.env.DEVCIRCUIT_TEST_ALLOW_UNSANDBOXED = "1";

function baseTask(id = "APP-001") {
  return createTask({
    id,
    title: "Deliver behavior",
    description: "Observable behavior",
    acceptance_criteria: ["Works end to end"],
    verification_commands: ["npm test"],
    manual_test_steps: ["Exercise behavior"]
  });
}

function baseState(tasks = [baseTask()]) {
  return {
    version: 1,
    policy_version: "test",
    run: { id: "RUN-1", title: "Test", summary: "", project_key: "test-v1", status: "planned", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
    specification: { revision: 1, content: "spec", sha256: "hash" },
    integrations: { linear: { team_id: "team", project_id: null, document_id: null }, github: { repository: "owner/repo", base_branch: "main" } },
    tasks,
    supervisor: { status: "watching", heartbeat_at: new Date().toISOString(), findings: [], audit_count: 0 },
    events: []
  };
}

function lease(agentId) {
  return { agent_id: agentId, principal: `principal-${agentId}`, workspace_id: `workspace-${agentId}`, adapter_sha256: "adapter" };
}

function assignRoles(state, taskId = "APP-001") {
  recordAgent(state, taskId, "implementer", lease("codex:/root/implement"));
  recordAgent(state, taskId, "reviewer", lease("codex:/root/review"));
  recordAgent(state, taskId, "gatekeeper", lease("codex:/root/gate"));
  recordAgent(state, taskId, "merger", lease("codex:/root/merge"));
}

function reachReview(state, taskId = "APP-001") {
  assignRoles(state, taskId);
  transitionTask(state, taskId, TASK_STATES.IMPLEMENTING, "codex:/root/implement", "start");
  const task = state.tasks.find((item) => item.id === taskId);
  task.git.branch = `agent/${taskId.toLowerCase()}`;
  task.git.head_sha = "abc123";
  task.git.pr_number = 1;
  task.git.pr_url = "https://github.com/owner/repo/pull/1";
  task.git.remote = { head_sha: "abc123", state: "OPEN", review_decision: "APPROVED", base_branch: "main", is_cross_repository: false, required_checks_passed: true, verified_at: new Date().toISOString() };
  recordEvidence(state, taskId, { kind: "implementation", producer: "codex:/root/implement", head_sha: "abc123", result: "pass" });
  recordEvidence(state, taskId, { kind: "test", source: "executed", producer: "codex:/root/implement", head_sha: "abc123", result: "pass", command: "npm test", exit_code: 0 });
  transitionTask(state, taskId, TASK_STATES.IN_REVIEW, "controller", "review");
  recordEvidence(state, taskId, { kind: "test", source: "executed", producer: "codex:/root/review", head_sha: "abc123", result: "pass", command: "npm test", exit_code: 0 });
  recordEvidence(state, taskId, { kind: "manual_test", producer: "codex:/root/review", head_sha: "abc123", result: "pass", step: "Exercise behavior" });
  recordEvidence(state, taskId, { kind: "acceptance", producer: "codex:/root/review", head_sha: "abc123", result: "pass", criterion: "Works end to end" });
  return task;
}

describe("Linear lifecycle", () => {
  it("projects the exact requested four statuses", () => {
    assert.equal(linearStatusFor(TASK_STATES.PLANNED), "Todo");
    assert.equal(linearStatusFor(TASK_STATES.IMPLEMENTING), "In Progress");
    assert.equal(linearStatusFor(TASK_STATES.IN_REVIEW), "In Review");
    assert.equal(linearStatusFor(TASK_STATES.REVIEW_PASSED), "Done");
    assert.equal(linearStatusFor(TASK_STATES.MERGED), "Done");
  });

  it("returns a failed review to In Progress and preserves its history", () => {
    const state = baseState();
    const task = reachReview(state);
    recordReview(state, task.id, "fail", "codex:/root/review", "abc123", "Seeded defect reproduced");
    assert.equal(task.status, TASK_STATES.IMPLEMENTING);
    assert.equal(task.linear.desired_status, "In Progress");
    assert.equal(task.review, null);
    assert.equal(task.reviews.length, 1);
    assert.equal(task.reviews[0].verdict, "fail");
  });

  it("sets Done immediately after independent current-SHA review passes", () => {
    const state = baseState();
    const task = reachReview(state);
    recordReview(state, task.id, "pass", "codex:/root/review", "abc123", "All criteria passed");
    assert.equal(task.status, TASK_STATES.REVIEW_PASSED);
    assert.equal(task.linear.desired_status, "Done");
  });
});

describe("role and evidence enforcement", () => {
  it("rejects one agent holding multiple roles", () => {
    const state = baseState();
    recordAgent(state, "APP-001", "implementer", lease("codex:/root/same"));
    assert.throws(() => recordAgent(state, "APP-001", "reviewer", lease("codex:/root/same")), /multiple task roles/);
  });

  it("rejects stale review and stale evidence", () => {
    const state = baseState();
    const task = reachReview(state);
    assert.throws(() => recordReview(state, task.id, "pass", "codex:/root/review", "old", "looks good"), /stale/);
    assert.throws(() => recordEvidence(state, task.id, { kind: "test", producer: "codex:/root/review", head_sha: "old", result: "pass" }), /stale/);
  });

  it("enforces delivery-wide WIP=1", () => {
    const state = baseState([baseTask("APP-001"), baseTask("APP-002")]);
    recordAgent(state, "APP-001", "implementer", lease("codex:/root/one"));
    recordAgent(state, "APP-002", "implementer", lease("codex:/root/two"));
    transitionTask(state, "APP-001", TASK_STATES.IMPLEMENTING, "codex:/root/one", "start");
    assert.throws(() => transitionTask(state, "APP-002", TASK_STATES.IMPLEMENTING, "codex:/root/two", "start"), /WIP=1/);
  });

  it("holds WIP until post-merge verification", () => {
    const state = baseState([baseTask("APP-001"), baseTask("APP-002")]);
    recordAgent(state, "APP-001", "implementer", lease("codex:/root/one"));
    recordAgent(state, "APP-002", "implementer", lease("codex:/root/two"));
    state.tasks[0].status = TASK_STATES.REVIEW_PASSED;
    state.tasks[0].linear.desired_status = "Done";
    assert.throws(() => transitionTask(state, "APP-002", TASK_STATES.IMPLEMENTING, "codex:/root/two", "start"), /WIP=1/);
  });

  it("fails closed without a fresh supervisor heartbeat", () => {
    const state = baseState();
    recordAgent(state, "APP-001", "implementer", lease("codex:/root/one"));
    state.supervisor.heartbeat_at = "2020-01-01T00:00:00.000Z";
    assert.throws(() => transitionTask(state, "APP-001", TASK_STATES.IMPLEMENTING, "codex:/root/one", "start"), /heartbeat is stale/);
  });
});

describe("merge gate", () => {
  it("denies when Linear Done has not been confirmed", () => {
    const state = baseState();
    const task = reachReview(state);
    recordReview(state, task.id, "pass", "codex:/root/review", "abc123", "passed");
    const gate = auditMergeGate(state, task.id, "codex:/root/gate");
    assert.equal(gate.decision, "DENY");
    assert.equal(gate.checks.find((item) => item.id === "linear.synced").result, "fail");
  });

  it("allows only a complete current-SHA independent evidence bundle", () => {
    const state = baseState();
    const task = reachReview(state);
    recordReview(state, task.id, "pass", "codex:/root/review", "abc123", "passed");
    task.linear.actual_status = "Done";
    task.linear.sync_pending = false;
    const gate = auditMergeGate(state, task.id, "codex:/root/gate");
    assert.equal(gate.decision, "ALLOW");
    assert.equal(task.status, TASK_STATES.MERGE_READY);
  });

  it("detects fabricated Done and stale gate state", () => {
    const state = baseState();
    const task = state.tasks[0];
    task.linear.desired_status = "Done";
    task.gate = { decision: "ALLOW", head_sha: "old" };
    task.git.head_sha = "new";
    const audit = auditState(state);
    assert.equal(audit.ok, false);
    assert.ok(audit.findings.some((item) => item.code === "linear.false_done"));
    assert.ok(audit.findings.some((item) => item.code === "gate.stale"));
  });

  it("does not accept repeated or wrong commands in place of the contract", () => {
    const state = baseState();
    const task = reachReview(state);
    task.contract.verification_commands = ["npm test", "npm run e2e"];
    recordEvidence(state, task.id, { kind: "test", source: "executed", producer: "codex:/root/review", head_sha: "abc123", result: "pass", command: "true", exit_code: 0 });
    assert.throws(() => recordReview(state, task.id, "pass", "codex:/root/review", "abc123", "passed"), /Review checklist incomplete/);
    assert.equal(task.status, TASK_STATES.IN_REVIEW);
    assert.equal(task.linear.desired_status, "In Review");
  });
});

describe("sealed state", () => {
  it("rejects direct workflow-state edits", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-"));
    const file = path.join(root, "state.json");
    writeState(file, baseState(), "test");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    raw.tasks[0].linear.desired_status = "Done";
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => readState(file), /integrity mismatch/);
  });

  it("initializes a complete sealed run from spec and tasks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-init-"));
    const spec = path.join(root, "spec.md");
    const tasks = path.join(root, "tasks.json");
    fs.writeFileSync(spec, "# Spec\n");
    fs.writeFileSync(tasks, JSON.stringify([{ id: "APP-001", title: "One", description: "Do one", verification_commands: ["npm test"] }]));
    const statePath = init({ run: "RUN-1", title: "Run", projectKey: "run-v1", teamId: "team", githubRepo: "owner/repo", specFile: spec, tasksFile: tasks }, root);
    const state = readState(statePath);
    assert.equal(state.tasks[0].linear.desired_status, "Todo");
    assert.equal(state.supervisor.status, "required");
  });
});

describe("Linear synchronization", () => {
  it("creates project, document, task and verifies the exact status", async () => {
    const state = baseState();
    const calls = [];
    const client = {
      workflowStates: async () => new Map(["todo", "in progress", "in review", "done"].map((name) => [name, { id: name, name }])),
      ensureProject: async (input) => { calls.push(["project", input]); return { project: { id: "project", url: "linear/project" }, created: true }; },
      ensureDocument: async (input) => { calls.push(["document", input]); return { id: "document", url: "linear/document" }; },
      ensureIssue: async (input) => { calls.push(["issue", input]); return { id: "issue", url: "linear/issue" }; },
      updateIssueStatus: async (_id, stateId) => ({ id: stateId, name: stateId === "todo" ? "Todo" : stateId })
    };
    await syncLinearState(state, client);
    assert.equal(state.integrations.linear.project_id, "project");
    assert.equal(state.tasks[0].linear.issue_id, "issue");
    assert.equal(state.tasks[0].linear.actual_status, "Todo");
    assert.equal(state.tasks[0].linear.sync_pending, false);
    assert.deepEqual(calls.map((item) => item[0]), ["project", "document", "issue"]);
  });
});

describe("randomized status projection checks", () => {
  it("never maps a non-reviewed state to Done", () => {
    const states = Object.values(TASK_STATES);
    for (let i = 0; i < 10000; i += 1) {
      const state = states[Math.floor(Math.random() * states.length)];
      const projected = linearStatusFor(state);
      if ([TASK_STATES.PLANNED, TASK_STATES.IMPLEMENTING, TASK_STATES.IN_REVIEW, TASK_STATES.BLOCKED].includes(state)) assert.notEqual(projected, "Done");
    }
  });
});

describe("request planning", () => {
  it("turns a raw request into validated specification and task artifacts through the planner adapter", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-plan-"));
    const request = path.join(root, "request.txt");
    const result = path.join(root, "result.json");
    const adapter = path.join(root, "planner.sh");
    fs.writeFileSync(request, "Build a search endpoint");
    fs.writeFileSync(result, JSON.stringify({ specification: "# Search\n", tasks: [{ id: "API-001", title: "Search", description: "Implement search", acceptance_criteria: ["GET search works"], verification_commands: ["npm test"], manual_test_steps: ["Call endpoint"] }] }));
    fs.writeFileSync(adapter, `#!/bin/sh\necho '${result}'\n`, { mode: 0o700 });
    const artifacts = analyzeRequest({ requestFile: request, adapter, outputDirectory: path.join(root, "planning") });
    assert.equal(fs.readFileSync(artifacts.specificationPath, "utf8"), "# Search\n");
    assert.equal(JSON.parse(fs.readFileSync(artifacts.tasksPath, "utf8"))[0].id, "API-001");
  });
});

describe("readiness and concurrent projects", () => {
  it("classifies required tools and human-owned authority setup", () => {
    const checks = localChecks();
    assert.ok(checks.some((item) => item.id === "tool.node" && item.installation_owner === "human"));
    assert.ok(checks.some((item) => item.id === "config.linear_token" && item.installation_owner === "human"));
    assert.ok(checks.some((item) => item.id === "tool.claude" && item.required === false));
  });

  it("rejects fake, non-executable, malformed, and non-isolating sandbox runners", () => {
    assert.equal(verifySandboxRunner("/bin/echo", sha256("/bin/echo")).available, false);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-runner-"));
    const nonExecutable = path.join(root, "noexec");
    fs.writeFileSync(nonExecutable, "noop\n", { mode: 0o600 });
    assert.equal(verifySandboxRunner(nonExecutable, sha256(nonExecutable)).available, false);
    const malformed = path.join(root, "malformed");
    fs.writeFileSync(malformed, "#!/bin/sh\necho not-json\n", { mode: 0o700 });
    assert.equal(verifySandboxRunner(malformed, sha256(malformed)).available, false);
    const liar = path.join(root, "liar");
    fs.writeFileSync(liar, "#!/bin/sh\necho '{\"schema\":\"devcircuit.sandbox-self-test/v1\",\"status\":\"pass\"}'\n", { mode: 0o700 });
    assert.equal(verifySandboxRunner(liar, sha256(liar)).available, false);
  });

  it("creates isolated run-scoped worktrees for concurrent deliveries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-worktrees-"));
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    const product = path.join(root, "product");
    const commands = [
      [root, ["init", "--bare", remote]],
      [root, ["init", "-b", "main", seed]],
      [seed, ["config", "user.email", "test@example.com"]],
      [seed, ["config", "user.name", "Test"]]
    ];
    for (const [cwd, args] of commands) assert.equal(spawnSync("git", args, { cwd, encoding: "utf8" }).status, 0);
    fs.writeFileSync(path.join(seed, "README.md"), "seed\n");
    for (const args of [["add", "README.md"], ["commit", "-m", "seed"], ["remote", "add", "origin", remote], ["push", "-u", "origin", "main"]]) assert.equal(spawnSync("git", args, { cwd: seed, encoding: "utf8" }).status, 0);
    assert.equal(spawnSync("git", ["clone", remote, product], { cwd: root, encoding: "utf8" }).status, 0);
    const first = baseTask("APP-001");
    const second = baseTask("APP-001");
    github.prepareWorktree(first, product, "RUN-A", path.join(root, "run-a"));
    github.prepareWorktree(second, product, "RUN-B", path.join(root, "run-b"));
    assert.notEqual(first.git.branch, second.git.branch);
    assert.notEqual(first.git.worktree_path, second.git.worktree_path);
    assert.equal(fs.existsSync(first.git.worktree_path), true);
    assert.equal(fs.existsSync(second.git.worktree_path), true);
    github.cleanupWorktree(first);
    github.cleanupWorktree(second);
  });
});

describe("executable evidence and durable supervisor", () => {
  it("scrubs controller, Linear, and GitHub credentials from worker processes", () => {
    const env = workerEnv({ PATH: "/bin", DEVCIRCUIT_WORKER_ENV_ALLOW: "SAFE_VALUE", DEVCIRCUIT_STATE_KEY: "secret", LINEAR_API_KEY: "linear", GH_TOKEN: "github", SAFE_VALUE: "ok", AWS_SECRET_ACCESS_KEY: "aws" });
    assert.equal(env.PATH, "/bin");
    assert.equal(env.SAFE_VALUE, "ok");
    assert.equal(env.DEVCIRCUIT_WORKER, "1");
    assert.equal(env.DEVCIRCUIT_STATE_KEY, undefined);
    assert.equal(env.LINEAR_API_KEY, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  });
  it("records evidence from a command the harness actually ran", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-check-"));
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    for (const args of [["init"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"], ["checkout", "-b", "agent/app-001"], ["commit", "--allow-empty", "-m", "base"]]) {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const state = baseState();
    assignRoles(state);
    const task = state.tasks[0];
    task.status = TASK_STATES.IMPLEMENTING;
    task.linear.desired_status = "In Progress";
    task.git.branch = "agent/app-001";
    task.git.head_sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    const statePath = path.join(root, "runs", "RUN-1", "workflow-state.json");
    writeState(statePath, state, "test");
    const result = await execute(["run-check", "--state", statePath, "--task", "APP-001", "--repo", repo, "--producer", "codex:/root/implement", "--label", "real", "--", process.execPath, "-e", "process.exit(0)"]);
    assert.ok(result.output.endsWith(".log"));
    const saved = readState(statePath);
    assert.equal(saved.tasks[0].evidence[0].source, "executed");
    assert.equal(saved.tasks[0].evidence[0].exit_code, 0);
  });

  it("writes a supervisor heartbeat without weakening the state seal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-monitor-"));
    const statePath = path.join(root, "RUN-1", "workflow-state.json");
    writeState(statePath, baseState(), "test");
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/monitor.js"), "--once", "--runs", root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const saved = readState(statePath);
    assert.equal(saved.supervisor.status, "watching");
    assert.ok(saved.supervisor.heartbeat_at);
    assert.equal(saved.supervisor.audit_count, 1);
  });

  it("dispatches through an explicit adapter and records the external lease", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-dispatch-"));
    const statePath = path.join(root, "RUN-1", "workflow-state.json");
    writeState(statePath, baseState(), "test");
    const adapter = path.join(root, "adapter.sh");
    fs.writeFileSync(adapter, "#!/bin/sh\necho '{\"agent_id\":\"codex:/root/fresh-implementer\",\"principal\":\"runtime-1\",\"workspace_id\":\"worktree-1\"}'\n", { mode: 0o700 });
    await execute(["dispatch-agent", "--state", statePath, "--task", "APP-001", "--role", "implementer", "--adapter", adapter]);
    const saved = readState(statePath);
    assert.equal(saved.tasks[0].agents.implementer, "codex:/root/fresh-implementer");
    assert.ok(saved.events.some((item) => item.type === "agent.dispatched"));
  });

  it("accepts only task-role-attempt scoped inbox capabilities without exposing the state key", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-inbox-"));
    const statePath = path.join(root, "RUN-1", "workflow-state.json");
    const state = baseState();
    const token = "scoped-random-capability";
    const capabilityHash = require("node:crypto").createHash("sha256").update(token).digest("hex");
    recordAgent(state, "APP-001", "implementer", { ...lease("codex:/root/implement"), capability_hash: capabilityHash, inbox: path.join(root, "RUN-1", "inbox"), attempt: 1 });
    writeState(statePath, state, "test");
    const payloadFile = path.join(root, "payload.json");
    fs.writeFileSync(payloadFile, JSON.stringify({ head_sha: "abc", artifact: "log" }));
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../scripts/submit.js"), "--inbox", path.join(root, "RUN-1", "inbox"), "--token", token, "--task", "APP-001", "--role", "implementer", "--attempt", "1", "--type", "implementation", "--payload-file", payloadFile], { encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(submissions.pending(statePath, readState(statePath)).length, 1);
    const raw = fs.readFileSync(result.stdout.trim(), "utf8");
    assert.equal(raw.includes(process.env.DEVCIRCUIT_STATE_KEY), false);
  });

  it("quarantines malformed inbox files without blocking valid work", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "devcircuit-quarantine-"));
    const statePath = path.join(root, "RUN-1", "workflow-state.json");
    const state = baseState();
    writeState(statePath, state, "test");
    const inbox = path.join(root, "RUN-1", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "bad.json"), "{partial");
    assert.deepEqual(submissions.pending(statePath, readState(statePath)), []);
    assert.equal(fs.existsSync(path.join(inbox, "rejected", "bad.json.rejected")), true);
  });

  it("journals submission processing and recognizes completed replay", () => {
    const state = baseState();
    const envelope = { id: "submission-1", task_id: "APP-001", role: "implementer", type: "implementation", attempt: 1 };
    assert.equal(submissions.begin(state, envelope, "owner-1"), "processing");
    assert.equal(submissions.begin(state, envelope, "owner-2"), "claimed");
    assert.equal(submissions.begin(state, envelope, "owner-1"), "resuming");
    submissions.complete(state, envelope);
    assert.equal(submissions.begin(state, envelope, "owner-2"), "processed");
  });
});
