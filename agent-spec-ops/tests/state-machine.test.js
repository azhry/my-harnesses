"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");
const TMP = path.join(ROOT, ".test-tmp");

function runScript(script, args = [], options = {}) {
  const cmd = `"${process.execPath}" "${path.join(SCRIPTS, script)}" ${args.map(a => `"${a}"`).join(" ")}`;
    const execOptions = { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_LIFECYCLE_SKIP: "1", SKIP_CONTEXT_CHECK: "1", SKIP_DOCKER_VERIFY: "1", LINEAR_API_KEY: "lin_test_12345678901234567890", LINEAR_TEAM_ID: "team-test" }, ...options };
  try {
    const stdout = execSync(cmd, execOptions);
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (e) {
    return { stdout: e.stdout.trim(), stderr: e.stderr.trim(), exitCode: e.status };
  }
}

function loadState() {
  return JSON.parse(fs.readFileSync(path.join(TMP, "workflow-state.json"), "utf8"));
}

function writeState(state) {
  fs.writeFileSync(path.join(TMP, "workflow-state.json"), JSON.stringify(state, null, 2) + "\n");
}

function baseState() {
  const state = JSON.parse(
    fs.readFileSync(path.join(ROOT, "templates", "workflow-state.json"), "utf8")
  );
  state.current_state = "implementation_in_progress";
  state.delivery = state.delivery || {};
  state.delivery.id = "TEST-001";
  state.delivery.title = "Test";
  state.delivery.created_at = new Date().toISOString();
  state.delivery.updated_at = new Date().toISOString();
  state.log = [];
  state.memory = state.memory || {};
  state.memory.events_path = "events.ndjson";
  state.memory.local_tasks_path = "tasks.json";
  state.memory.evals_csv_path = "evals.csv";
  state.memory.remarks_csv_path = "remarks.csv";
  state.memory.token_usage_csv_path = "token-usage.csv";
  state.memory.knowledge_dirs = ["knowledge/candidates", "knowledge/promoted"];
  state.memory.event_count = 0;
  state.memory.local_task_provider = {
    enabled: false,
    mode: "external",
    reason: "Test fixture uses Linear as task system of record.",
    external_provider: "linear",
    sync_status: "synced",
    last_synced_at: new Date().toISOString(),
    path: "tasks.json"
  };
  state.task_graph = state.task_graph || {};
  state.task_graph.tasks = [];
  state.roles = state.roles || {};
  for (const role of ["product_manager", "project_manager", "frontend_dev", "frontend_test", "backend_dev", "backend_test", "orchestrator"]) {
    state.roles[role] = state.roles[role] || { status: "not_started", current_task_id: "", artifacts: [], evidence: [], blockers: [] };
  }
  state.implementation = state.implementation || {};
  state.implementation.git_policy = state.implementation.git_policy || {
    base_branch: "main",
    target_branch: "main",
    push_after_tests_pass: true,
    merge_request_required: true,
    auto_merge_default: true,
    auto_merge_requires_checks: true,
    auto_merge_disabled_reason: "",
    evidence: []
  };
  state.loops = state.loops || {};
  for (const loop of ["product", "planning", "frontend_dev_test", "backend_dev_test", "integration", "knowledge_improvement"]) {
    state.loops[loop] = state.loops[loop] || { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] };
  }
  state.tool_readiness = state.tool_readiness || {};
  state.tool_readiness.status = "ready";
  state.tool_readiness.choices = { product_tracker: "linear", code_host: "github" };
  state.gates = state.gates || {};
  for (const gate of ["tool_readiness_review", "product_review", "delivery_plan_review"]) {
    state.gates[gate] = { status: "approved", approver: "test", approval_note: "test setup", decided_at: new Date().toISOString(), evidence: [] };
  }
  return state;
}

function makeFeTask(id, deps = []) {
  return {
    id,
    linear_id: `lin-${id}`,
    title: `FE task ${id}`,
    role: "frontend_dev",
    status: "planned",
    depends_on: deps,
    source_requirements: [],
    knowledge_refs: [],
    description: "Test frontend task",
    expected_changes: [],
    scope: { allowed_paths: ["test/"], allowed_repos: ["test"], allowed_services: ["frontend"], contract_refs: [] },
    definition_of_done: ["works"],
    verification: ["tests pass"],
    git_flow: {
      base_branch: "main", target_branch: "main", feature_branch: `feat/${id}`,
      branch_created: true, branch_evidence: ["created"],
      local_tests_passed: true, test_evidence: ["tests ok"],
      pushed: true, push_evidence: ["pushed"],
      merge_request_status: "merged", merge_request_url: `https://github.com/test/pull/${id}`,
      merge_request_evidence: ["PR created"],
      auto_merge: true, auto_merge_disabled_reason: "",
      merge_checks_passed: true, merge_check_evidence: ["checks passed"],
      merged: true, merge_commit: "abc123",
      merge_evidence: ["merged"],
      blockers: []
    },
    implementation: { changed_files: ["test/file.ts"], evidence: ["implemented"], deviations: [] },
    test: { status: "passed", last_run_at: new Date().toISOString(), output_file: "test-output/test.log", cases: ["test works"], commands: ["npm test"], evidence: ["all tests pass"], failures: [] },
    loop: { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] }
  };
}

function makeBeTask(id, deps = []) {
  return {
    id,
    linear_id: `lin-${id}`,
    title: `BE task ${id}`,
    role: "backend_dev",
    status: "planned",
    depends_on: deps,
    source_requirements: [],
    knowledge_refs: [],
    description: "Test backend task",
    expected_changes: [],
    scope: { allowed_paths: ["test/"], allowed_repos: ["test"], allowed_services: ["backend"], contract_refs: [] },
    definition_of_done: ["works"],
    verification: ["tests pass"],
    git_flow: {
      base_branch: "main", target_branch: "main", feature_branch: `feat/${id}`,
      branch_created: true, branch_evidence: ["created"],
      local_tests_passed: true, test_evidence: ["tests ok"],
      pushed: true, push_evidence: ["pushed"],
      merge_request_status: "merged", merge_request_url: `https://github.com/test/pull/${id}`,
      merge_request_evidence: ["PR created"],
      auto_merge: true, auto_merge_disabled_reason: "",
      merge_checks_passed: true, merge_check_evidence: ["checks passed"],
      merged: true, merge_commit: "abc123",
      merge_evidence: ["merged"],
      blockers: []
    },
    implementation: { changed_files: ["test/file.ts"], evidence: ["implemented"], deviations: [] },
    test: { status: "passed", last_run_at: new Date().toISOString(), output_file: "test-output/test.log", cases: ["test works"], commands: ["npm test"], evidence: ["all tests pass"], failures: [] },
    loop: { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] }
  };
}

describe("transition-task.js", () => {
  before(() => {
    fs.mkdirSync(TMP, { recursive: true });
    fs.mkdirSync(path.join(TMP, "test-output"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "test-output", "test.log"), "All tests passed\n");
  });

  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it("rejects unknown task", () => {
    const state = baseState();
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "NONEXIST", "verified"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("Task not found"));
  });

  it("rejects invalid task status", () => {
    const state = baseState();
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "invalid_status"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("Invalid task status"));
  });

  it("rejects illegal task transition: planned -> verified (skip states)", () => {
    const state = baseState();
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "verified"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("Illegal task transition"));
  });

  it("accepts planned -> active", () => {
    const state = baseState();
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "active"]);
    assert.equal(result.exitCode, 0);
    const updated = loadState();
    const task = updated.task_graph.tasks.find(t => t.id === "FE-001");
    assert.equal(task.status, "active");
    assert.equal(task.loop.status, "in_progress");
    assert.equal(updated.roles.frontend_dev.status, "in_progress");
  });

  it("rejects active when dependency is not verified", () => {
    const state = baseState();
    state.task_graph.tasks = [
      makeFeTask("FE-001"),
      makeFeTask("FE-002", ["FE-001"])
    ];
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-002", "active"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("depends on") && result.stderr.includes("not verified"));
  });

  it("rejects WIP=1 violation: two active tasks in same lane", () => {
    const state = baseState();
    const fe1 = makeFeTask("FE-001");
    fe1.status = "active";
    state.task_graph.tasks = [
      fe1,
      makeFeTask("FE-002")
    ];
    writeState(state);
    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-002", "active"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("WIP=1 violation"));
  });

  it("advances through full lifecycle: planned -> active -> implemented -> testing -> verified", () => {
    const state = baseState();
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);

    let result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "active"]);
    assert.equal(result.exitCode, 0, "planned -> active");

    result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "implemented"]);
    assert.equal(result.exitCode, 0, "active -> implemented");

    result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "testing"]);
    assert.equal(result.exitCode, 0, "implemented -> testing");

    result = runScript("record-token-usage.js", [
      path.join(TMP, "workflow-state.json"),
      "--scope", "task",
      "--task", "FE-001",
      "--input-tokens", "100",
      "--output-tokens", "50",
      "--total-cost-usd", "0.002",
      "--cost-basis", "estimated"
    ]);
    assert.equal(result.exitCode, 0, "record token usage");

    result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "verified"]);
    assert.equal(result.exitCode, 0, "testing -> verified");

    const updated = loadState();
    const task = updated.task_graph.tasks.find(t => t.id === "FE-001");
    assert.equal(task.status, "verified");
    assert.equal(task.loop.status, "completed");
    assert.equal(updated.roles.frontend_dev.status, "complete");
  });

  it("blocks verified when git_flow has no PR", () => {
    const state = baseState();
    const task = makeFeTask("FE-001");
    task.git_flow.merge_request_status = "not_started";
    task.git_flow.merge_request_url = "";
    task.status = "testing";
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "verified"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("merge_request"));
  });

  it("blocks verified when not pushed", () => {
    const state = baseState();
    const task = makeFeTask("FE-001");
    task.git_flow.pushed = false;
    task.git_flow.push_evidence = [];
    task.status = "testing";
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "verified"]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("pushed"));
  });

  it("allows task to be marked failed", () => {
    const state = baseState();
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);

    let result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "active"]);
    assert.equal(result.exitCode, 0);

    result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "failed", "Test failure"]);
    assert.equal(result.exitCode, 0);

    const updated = loadState();
    const task = updated.task_graph.tasks.find(t => t.id === "FE-001");
    assert.equal(task.status, "failed");
    assert.equal(task.loop.status, "failed");
    assert.equal(task.loop.last_failure, "Test failure");
    assert.equal(task.loop.attempt, 2);
  });

  it("allows retry from failed -> active", () => {
    const state = baseState();
    const task = makeFeTask("FE-001");
    task.status = "failed";
    task.loop = { status: "failed", attempt: 1, max_attempts: 3, last_failure: "bug", history: [] };
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("transition-task.js", [path.join(TMP, "workflow-state.json"), "FE-001", "active"]);
    assert.equal(result.exitCode, 0);

    const updated = loadState();
    assert.equal(updated.task_graph.tasks[0].status, "active");
  });
});

describe("transition.js", () => {
  before(() => {
    fs.mkdirSync(TMP, { recursive: true });
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
  });

  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it("rejects direct jump to integration_verification with unverified tasks", () => {
    const result = runScript("transition.js", [
      path.join(TMP, "workflow-state.json"),
      "integration_verification"
    ]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("unverified tasks"));
  });

  it("rejects transition to invalid state", () => {
    const result = runScript("transition.js", [
      path.join(TMP, "workflow-state.json"),
      "implementation_complete"
    ]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("Invalid next state"));
  });
});

describe("validate-state.js", () => {
  before(() => {
    fs.mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it("rejects state with invalid top-level state name", () => {
    const state = baseState();
    state.current_state = "implementation_complete";
    writeState(state);
    const result = runScript("validate-state.js", [path.join(TMP, "workflow-state.json")]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes('"implementation_complete" is not a valid state'));
  });

  it("rejects integration_verification with unverified frontend tasks", () => {
    const state = baseState();
    state.current_state = "integration_verification";
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
    const result = runScript("validate-state.js", [path.join(TMP, "workflow-state.json")]);
    assert.ok(result.exitCode !== 0);
    assert.ok(result.stderr.includes("integration_verification requires all tasks verified"))
      || assert.ok(result.stderr.includes("Unverified"));
  });

  it("passes when all tasks are verified in integration_verification", () => {
    const state = baseState();
    state.current_state = "integration_verification";
    const task = makeFeTask("FE-001");
    task.status = "verified";
    state.task_graph.tasks = [task];
    writeState(state);
    const result = runScript("validate-state.js", [path.join(TMP, "workflow-state.json")]);
    assert.equal(result.exitCode, 0);
  });

  it("passes for valid frontend lane state", () => {
    const state = baseState();
    state.current_state = "frontend_dev";
    state.task_graph.tasks = [makeFeTask("FE-001")];
    writeState(state);
    const result = runScript("validate-state.js", [path.join(TMP, "workflow-state.json")]);
    assert.equal(result.exitCode, 0);
  });
});

describe("record-event.js", () => {
  before(() => {
    fs.mkdirSync(TMP, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  it("applies --set updates to workflow-state.json", () => {
    const state = baseState();
    state.gates.product_review.status = "pending";
    state.gates.product_review.approver = "";
    writeState(state);

    const result = runScript("record-event.js", [
      path.join(TMP, "workflow-state.json"),
      "--type", "config_update",
      "--summary", "Approve product gate",
      "--set", "gates.product_review.status=approved",
      "--set", "gates.product_review.approver=tester"
    ]);

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Applied 2 state update"));
    const updated = loadState();
    assert.equal(updated.gates.product_review.status, "approved");
    assert.equal(updated.gates.product_review.approver, "tester");
  });

  it("parses --set JSON, boolean, and numeric values", () => {
    const state = baseState();
    writeState(state);

    const result = runScript("record-event.js", [
      path.join(TMP, "workflow-state.json"),
      "--type", "config_update",
      "--summary", "Update structured state",
      "--set", "artifacts.demo.evidence=[1,2]",
      "--set", "artifacts.demo.ready=true",
      "--set", "artifacts.demo.count=2"
    ]);

    assert.equal(result.exitCode, 0);
    const updated = loadState();
    assert.deepEqual(updated.artifacts.demo.evidence, [1, 2]);
    assert.equal(updated.artifacts.demo.ready, true);
    assert.equal(updated.artifacts.demo.count, 2);
  });
});
