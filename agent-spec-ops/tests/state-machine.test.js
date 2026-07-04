"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const { canTransition } = require("../scripts/lib/state-machine");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".test-tmp");
const SCRIPTS = path.join(ROOT, "scripts");

function runScript(script, args = []) {
  const cmd = `"${process.execPath}" "${path.join(SCRIPTS, script)}" ${args.map((arg) => `"${arg}"`).join(" ")}`;
  try {
    const stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        SKIP_CONTEXT_CHECK: "1",
        SKIP_INTEGRATION_VERIFY: "1",
        GIT_LIFECYCLE_SKIP: "1",
        AGENT_SPEC_OPS_ALLOW_SKIP_PR_COMMENT: "1",
        LINEAR_API_KEY: "lin_test_12345678901234567890",
        LINEAR_TEAM_ID: "team-test"
      }
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitCode: error.status || 1,
      stdout: error.stdout || "",
      stderr: error.stderr || ""
    };
  }
}

function statePath() {
  return path.join(TMP, "workflow-state.json");
}

function loadState() {
  return JSON.parse(fs.readFileSync(statePath(), "utf8"));
}

function writeState(state) {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
}

function addLease(state, taskId, role, agentId = `agent-${taskId}-${role}`) {
  state.agent_dispatch.leases = state.agent_dispatch.leases || [];
  state.agent_dispatch.leases.push({
    task_id: taskId,
    role,
    agent_id: agentId,
    status: "leased",
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString()
  });
  state.agent_dispatch.spawn_requests = state.agent_dispatch.spawn_requests || [];
  state.agent_dispatch.spawn_requests.push({
    id: `spawn-${taskId}-${role}`,
    role,
    lane: role.startsWith("frontend") ? "frontend" : "backend",
    task_ids: [taskId],
    status: "spawned",
    agent_id: agentId,
    prompt: "test",
    write_scope: ["frontend/"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    blockers: []
  });
}

function baseState() {
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "workflow-state.json"), "utf8"));
  const now = new Date().toISOString();
  state.delivery.id = "TEST-001";
  state.delivery.title = "Compact harness test";
  state.delivery.created_at = now;
  state.delivery.updated_at = now;
  state.tool_readiness.status = "ready";
  state.tool_readiness.choices = { product_tracker: "linear", code_host: "github" };
  state.knowledge.sources = [{ id: "src-1", kind: "other", title: "brief", url: "", path: "brief.md", authority: "authoritative", checked_at: now, freshness: "current", confidence: "high" }];
  state.knowledge.findings = [{ id: "f-1", bucket: "product_knowledge", type: "requirement", claim: "User needs compact harness", confidence: "high", sources: ["src-1"], used_by: [] }];
  state.artifacts.product_requirements = artifact("runs/TEST-001/product-requirements.md");
  state.artifacts.design_assets = artifact("runs/TEST-001/design-assets/");
  state.artifacts.system_rules = artifact("runs/TEST-001/system-rules.md");
  state.gates.product_review = approvedGate(now);
  state.gates.system_rules_review = approvedGate(now);
  state.gates.implementation_review = approvedGate(now);
  state.task_graph.dependencies_checked = true;
  state.task_graph.status = "approved";
  state.agent_dispatch.mode = "multi_agent";
  state.agent_dispatch.parallel_allowed = true;
  state.agent_dispatch.auto_spawn = true;
  state.memory.local_task_provider = {
    enabled: false,
    mode: "external",
    reason: "Linear is required",
    external_provider: "linear",
    sync_status: "synced",
    last_synced_at: now,
    path: ""
  };
  return state;
}

function artifact(pathValue) {
  return { status: "ready_for_review", path: pathValue, url: "", content_hash: "", evidence: [pathValue] };
}

function approvedGate(now) {
  return { status: "approved", approver: "human", approval_note: "approved", decided_at: now, evidence: ["test"] };
}

function devTask(id, role, lane) {
  return {
    id,
    linear_id: `lin-${id}`,
    title: `${id} task`,
    role,
    lane,
    depends_on: [],
    status: "planned",
    source_requirements: ["REQ-1"],
    knowledge_refs: ["f-1"],
    description: "Do the work",
    expected_changes: [`${lane}/`],
    scope: { allowed_paths: [`${lane}/`], allowed_repos: ["project"], allowed_services: [lane], contract_refs: [] },
    definition_of_done: ["done"],
    verification: ["tests pass"],
    implementation: { changed_files: [`project/${lane}/file.ts`], evidence: ["implemented"], deviations: [] },
    test: { status: "passed", last_run_at: new Date().toISOString(), output_file: "test-output/test.log", cases: ["case"], commands: ["npm test"], evidence: ["passed"], failures: [] },
    git_flow: {
      base_branch: "main",
      target_branch: "main",
      feature_branch: `delivery/TEST-001/${id}`,
      branch_created: true,
      branch_evidence: ["branch"],
      local_tests_passed: true,
      test_evidence: ["tests"],
      pushed: true,
      push_evidence: ["push"],
      merge_request_status: "merged",
      merge_request_url: "https://github.com/test/repo/pull/1",
      merge_request_evidence: ["mr"],
      merge_request_comment_status: "passed",
      merge_request_comment_url: "https://github.com/test/repo/pull/1#issuecomment-1",
      merge_request_comment_evidence: ["MR status comment posted"],
      auto_merge: true,
      auto_merge_disabled_reason: "",
      merge_checks_passed: true,
      merge_check_evidence: ["checks"],
      merged: true,
      merge_commit: "abc123",
      merge_evidence: ["merged"],
      blockers: []
    },
    loop: { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] }
  };
}

describe("compact state machine", () => {
  it("uses the compact top-level flow and routes rework to task breakdown", () => {
    assert.equal(canTransition("product_requirements", "product_review"), true);
    assert.equal(canTransition("product_requirements", "design_assembly"), false);
    assert.equal(canTransition("implementation_review", "task_breakdown"), true);
    assert.equal(canTransition("implementation_review", "done"), true);
    assert.equal(canTransition("implementation_review", "knowledge_discovery"), false);
  });
});

describe("transition.js", () => {
  before(() => {
    fs.mkdirSync(path.join(TMP, "test-output"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "test-output", "test.log"), "ok\n");
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("rejects implementation without Linear task ids", () => {
    const state = baseState();
    state.current_state = "task_breakdown";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.linear_id = "";
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("transition.js", [statePath(), "implementation_in_progress", "start"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /linear_id/);
  });

  it("allows task breakdown to implementation when checklist passes", () => {
    const state = baseState();
    state.current_state = "task_breakdown";
    state.task_graph.tasks = [
      devTask("FE-001", "frontend_dev", "frontend"),
      devTask("BE-001", "backend_dev", "backend")
    ];
    writeState(state);

    const result = runScript("transition.js", [statePath(), "implementation_in_progress", "start"]);
    assert.equal(result.exitCode, 0);
    assert.equal(loadState().current_state, "implementation_in_progress");
  });

  it("allows implementation review only after frontend/backend tasks are verified", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const fe = devTask("FE-001", "frontend_dev", "frontend");
    const be = devTask("BE-001", "backend_dev", "backend");
    fe.status = "verified";
    be.status = "verified";
    state.task_graph.tasks = [fe, be];
    writeState(state);

    const result = runScript("transition.js", [statePath(), "implementation_review", "ready"]);
    assert.equal(result.exitCode, 0);
    assert.equal(loadState().current_state, "implementation_review");
  });
});

describe("transition-task.js", () => {
  before(() => {
    fs.mkdirSync(path.join(TMP, "test-output"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "test-output", "test.log"), "ok\n");
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("keeps top-level state in implementation while task moves", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "start"]);
    assert.equal(result.exitCode, 0);
    const updated = loadState();
    assert.equal(updated.current_state, "implementation_in_progress");
    assert.equal(updated.task_graph.tasks[0].status, "active");
  });

  it("rejects task execution without a recorded role lease", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "start"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /frontend_dev subagent lease/);
  });

  it("rejects verified when the task MR is not merged", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.git_flow.merge_request_status = "open";
    task.git_flow.merged = false;
    task.git_flow.merge_commit = "";
    task.git_flow.merge_evidence = [];
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /must be merged/);
  });

  it("allows verified only after merged MR evidence exists", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.equal(result.exitCode, 0);
    assert.equal(loadState().task_graph.tasks[0].status, "verified");
  });

  it("blocks retry after dev/test loop reaches three attempts", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "failed";
    task.loop = { status: "failed", attempt: 3, max_attempts: 3, last_failure: "still failing", history: [] };
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "retry"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /user to intervene/);
  });
});

describe("validate-state.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("rejects verified dev tasks without merged MR evidence", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "verified";
    task.git_flow.merge_request_status = "open";
    task.git_flow.merged = false;
    task.git_flow.merge_commit = "";
    task.git_flow.merge_evidence = [];
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("validate-state.js", [statePath()]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /verified requires merged MR status/);
  });
});

describe("check-write-scope.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("rejects orchestrator writes into project task scope", () => {
    const state = baseState();
    state.workspace_root = ".test-tmp";
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    task.scope.allowed_paths = ["frontend/**"];
    state.task_graph.tasks = [task];
    fs.mkdirSync(path.join(TMP, "project", "frontend"), { recursive: true });
    writeState(state);

    const target = path.join(TMP, "project", "frontend", "file.ts");
    const result = runScript("check-write-scope.js", [statePath(), target, "orchestrator"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /not an active task for role orchestrator/);
  });

  it("allows the matching active dev role into project task scope", () => {
    const state = baseState();
    state.workspace_root = ".test-tmp";
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    task.scope.allowed_paths = ["frontend/**"];
    state.task_graph.tasks = [task];
    fs.mkdirSync(path.join(TMP, "project", "frontend"), { recursive: true });
    writeState(state);

    const target = path.join(TMP, "project", "frontend", "file.ts");
    const result = runScript("check-write-scope.js", [statePath(), target, "frontend_dev"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /active scope/);
  });
});

describe("record-test-results.js", () => {
  before(() => {
    fs.mkdirSync(path.join(TMP, "test-output"), { recursive: true });
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("rejects test results for planned tasks", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("record-test-results.js", [statePath(), "--task", "FE-001", "--status", "passed", "--role", "frontend_test", "--command", "npm test", "--output", "ok"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /cannot record test results while task status is planned/);
  });
});

describe("plan-agent-dispatch.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("plans a test-agent request after a dev task is implemented", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "implemented";
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("plan-agent-dispatch.js", [statePath(), "--enable-auto"]);
    assert.equal(result.exitCode, 0);
    const updated = loadState();
    const request = updated.agent_dispatch.spawn_requests.find((item) => item.task_ids.includes("FE-001"));
    assert.equal(request.role, "frontend_test");
    assert.match(request.prompt, /record-test-results/);
  });
});
