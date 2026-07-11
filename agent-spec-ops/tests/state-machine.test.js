"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const { canTransition } = require("../scripts/lib/state-machine");
const { writeWorkflowState } = require("../scripts/lib/state-store");

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
        NODE_ENV: "test",
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

function writeSealedState(state) {
  fs.mkdirSync(TMP, { recursive: true });
  writeWorkflowState(statePath(), state, { writer: "test" });
}

function agentNameForRole(role) {
  return `agent-spec-${role.replace(/_/g, "-")}`;
}

function sessionIdFor(taskId, role) {
  return `ses_${`${taskId}${role}`.replace(/[^A-Za-z0-9]/g, "")}`;
}

function addLease(state, taskId, role, agentId = sessionIdFor(taskId, role)) {
  state.agent_dispatch.leases = state.agent_dispatch.leases || [];
  state.agent_dispatch.leases.push({
    task_id: taskId,
    role,
    agent_name: agentNameForRole(role),
    agent_id: agentId,
    status: "leased",
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString()
  });
  state.agent_dispatch.spawn_requests = state.agent_dispatch.spawn_requests || [];
  state.agent_dispatch.spawn_requests.push({
    id: `spawn-${taskId}-${role}`,
    role,
    agent_name: agentNameForRole(role),
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

function markLeaseCompleted(state, taskId, role) {
  const lease = state.agent_dispatch.leases.find((item) => item.task_id === taskId && item.role === role);
  if (lease) {
    lease.status = "completed";
    lease.completed_at = new Date().toISOString();
  }
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
      submitted_head_sha: "abc123",
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
    review: {
      status: "passed",
      role: role === "frontend_dev" ? "frontend_test" : "backend_test",
      reviewer_agent_id: `ses_${id.replace(/[^A-Za-z0-9]/g, "")}reviewer`,
      reviewed_at: new Date().toISOString(),
      head_sha: "abc123",
      merge_request_url: "https://github.com/test/repo/pull/1",
      summary: "review passed",
      evidence: ["reviewed exact PR diff"]
    },
    loop: { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] }
  };
}

function taskBreakdownTask(id = "FE-099") {
  return {
    id,
    title: `${id} planned task`,
    lane: "frontend",
    role: "frontend_dev",
    depends_on: [],
    description: "Implement the planned frontend work.",
    expected_changes: ["frontend/app"],
    scope: {
      allowed_paths: ["frontend/app/**"],
      allowed_repos: ["project"],
      allowed_services: ["frontend"],
      contract_refs: []
    },
    definition_of_done: ["Frontend behavior is implemented"],
    verification: ["Run the frontend test command"],
    expected_mr_description: "Use the PR template and include scope, tests, MR comment, checks, and merge evidence."
  };
}

function writeTaskBreakdownFile(tasks) {
  const file = path.join(TMP, "task-breakdown.json");
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tasks }, null, 2) + "\n");
  return file;
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

  it("rejects option-like flags in the free-form note", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    writeState(state);

    const result = runScript("transition.js", [statePath(), "task_breakdown", "--role", "orchestrator"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Unexpected option/);
  });
});

describe("record-task-breakdown.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("records planned task entries from the official JSON artifact", () => {
    const state = baseState();
    state.current_state = "task_breakdown";
    state.task_graph.tasks = [];
    writeState(state);
    const taskFile = writeTaskBreakdownFile([taskBreakdownTask()]);

    const result = runScript("record-task-breakdown.js", [statePath(), "--file", taskFile, "--dependencies-checked"]);
    assert.equal(result.exitCode, 0);
    const updated = loadState();
    assert.equal(updated.task_graph.tasks.length, 1);
    assert.equal(updated.task_graph.tasks[0].id, "FE-099");
    assert.equal(updated.task_graph.tasks[0].status, "planned");
    assert.equal(updated.task_graph.tasks[0].test.status, "not_started");
    assert.equal(updated.task_graph.tasks[0].expected_mr_description.includes("PR template"), true);
    assert.equal(updated.task_graph.dependencies_checked, true);
    assert.equal(updated.task_graph.status, "approved");
    assert.equal(updated.artifacts.task_breakdown.path, "task-breakdown.json");
  });

  it("rejects task recording outside task_breakdown state", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [];
    writeState(state);
    const taskFile = writeTaskBreakdownFile([taskBreakdownTask("FE-100")]);

    const result = runScript("record-task-breakdown.js", [statePath(), "--file", taskFile]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /requires current_state=task_breakdown/);
  });

  it("rejects missing MR description template", () => {
    const state = baseState();
    state.current_state = "task_breakdown";
    state.task_graph.tasks = [];
    writeState(state);
    const task = taskBreakdownTask("FE-101");
    delete task.expected_mr_description;
    const taskFile = writeTaskBreakdownFile([task]);

    const result = runScript("record-task-breakdown.js", [statePath(), "--file", taskFile]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /expected_mr_description is required/);
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
    assert.equal(updated.task_graph.tasks[0].loop.status, "in_progress");
    assert.equal(updated.task_graph.tasks[0].loop.attempt, 0);
  });

  it("rejects task execution without a recorded role lease", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "start"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /valid frontend_dev OpenCode lease/);
  });

  it("enforces delivery-wide WIP=1 until the current task is verified", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const first = devTask("FE-001", "frontend_dev", "frontend");
    const second = devTask("BE-001", "backend_dev", "backend");
    first.status = "implemented";
    state.task_graph.tasks = [first, second];
    addLease(state, "BE-001", "backend_dev");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "BE-001", "active", "start"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Delivery WIP=1 violation/);
    assert.match(result.stderr, /finish FE-001 through verified PR review, merge, and Linear sync/);
  });

  it("rejects implemented without changed files and implementation evidence", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    task.implementation = { changed_files: [], evidence: [], deviations: [] };
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "implemented", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /implementation\.changed_files is empty/);
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
    const taskAfter = loadState().task_graph.tasks[0];
    assert.equal(taskAfter.status, "verified");
    assert.equal(taskAfter.loop.status, "completed");
    assert.equal(taskAfter.loop.attempt, 0);
    assert.equal(taskAfter.loop.last_failure, "");
  });

  it("rejects verified when another task already uses the same MR", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const first = devTask("FE-001", "frontend_dev", "frontend");
    const second = devTask("FE-002", "frontend_dev", "frontend");
    first.status = "testing";
    second.status = "verified";
    second.git_flow.merge_request_url = first.git_flow.merge_request_url;
    state.task_graph.tasks = [first, second];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /each task requires its own MR/);
  });

  it("rejects verified when MR comment URL is only the PR URL", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.git_flow.merge_request_comment_url = task.git_flow.merge_request_url;
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /actual comment/);
  });

  it("rejects verified when MR checks are not recorded as passed", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.git_flow.merge_checks_passed = false;
    task.git_flow.merge_check_evidence = [];
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /MR checks must be recorded as passed/);
  });

  it("rejects verified without independent review of the exact submitted HEAD", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.review = { status: "passed", head_sha: "stale-head", evidence: ["old review"] };
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "verified", "done"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Independent PR review evidence/);
    assert.match(result.stderr, /exact submitted HEAD/);
  });

  it("increments loop pressure only when a task fails", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const failed = runScript("transition-task.js", [statePath(), "FE-001", "failed", "unit tests failed"]);
    assert.equal(failed.exitCode, 0);
    let taskAfter = loadState().task_graph.tasks[0];
    assert.equal(taskAfter.loop.status, "failed");
    assert.equal(taskAfter.loop.attempt, 1);
    assert.equal(taskAfter.loop.last_failure, "unit tests failed");

    const retryState = loadState();
    addLease(retryState, "FE-001", "frontend_dev", "ses_retryfrontenddev");
    writeSealedState(retryState);

    const retried = runScript("transition-task.js", [statePath(), "FE-001", "active", "retry"]);
    assert.equal(retried.exitCode, 0);
    taskAfter = loadState().task_graph.tasks[0];
    assert.equal(taskAfter.loop.status, "in_progress");
    assert.equal(taskAfter.loop.attempt, 1);
  });

  it("blocks retry after dev/test loop reaches three attempts", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "failed";
    task.loop = { status: "failed", attempt: 3, max_attempts: 3, last_failure: "still failing", history: [] };
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "retry"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /user to intervene/);
  });

  it("rejects option-like flags in the free-form note", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("transition-task.js", [statePath(), "FE-001", "active", "--role", "orchestrator"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Unexpected option/);
  });
});

describe("record-agent-spawn.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("rejects generic OpenCode agents", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.agent_dispatch.spawn_requests = [{
      id: "spawn-fe",
      role: "frontend_dev",
      agent_name: "agent-spec-frontend-dev",
      lane: "frontend",
      task_ids: ["FE-001"],
      status: "planned",
      agent_id: "",
      prompt: "test",
      write_scope: ["frontend/"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      blockers: []
    }];
    writeState(state);

    const result = runScript("record-agent-spawn.js", [statePath(), "spawn-fe", "ses_generic", "--agent", "general"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /generic OpenCode agent/);
  });

  it("records only the exact expected OpenCode agent", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.agent_dispatch.spawn_requests = [{
      id: "spawn-fe",
      role: "frontend_dev",
      agent_name: "agent-spec-frontend-dev",
      lane: "frontend",
      task_ids: ["FE-001"],
      status: "planned",
      agent_id: "",
      prompt: "test",
      write_scope: ["frontend/"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      blockers: []
    }];
    writeState(state);

    const result = runScript("record-agent-spawn.js", [statePath(), "spawn-fe", "ses_frontenddev", "--agent", "agent-spec-frontend-dev"]);
    assert.equal(result.exitCode, 0);
    const lease = loadState().agent_dispatch.leases[0];
    assert.equal(lease.agent_name, "agent-spec-frontend-dev");
    assert.equal(lease.agent_id, "ses_frontenddev");
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

  it("rejects active leases without exact OpenCode agent identity", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    state.agent_dispatch.leases = [{
      task_id: "FE-001",
      role: "frontend_dev",
      agent_id: "direct-conversation-frontend_dev-fe-001",
      status: "leased",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString()
    }];
    writeState(state);

    const result = runScript("validate-state.js", [statePath()]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /invalid frontend_dev lease/);
  });

  it("rejects verified dev tasks without passed MR check evidence", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "verified";
    task.git_flow.merge_checks_passed = false;
    task.git_flow.merge_check_evidence = [];
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("validate-state.js", [statePath()]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /verified requires passed MR checks evidence/);
  });

  it("rejects direct edits after a state file is sealed", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [devTask("FE-001", "frontend_dev", "frontend")];
    writeSealedState(state);

    const tampered = loadState();
    tampered.task_graph.tasks[0].status = "verified";
    fs.writeFileSync(statePath(), JSON.stringify(tampered, null, 2) + "\n");

    const result = runScript("validate-state.js", [statePath()]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /state hash mismatch/);
  });
});

describe("seal-state.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("seals an operationally valid repaired state", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "verified";
    state.task_graph.tasks = [task];
    writeState(state);

    const result = runScript("seal-state.js", [statePath(), "manual repair"]);
    assert.equal(result.exitCode, 0);
    assert.equal(loadState().harness.state_integrity.sealed_by, "seal-state.js");
  });

  it("refuses to bless invalid workflow data", () => {
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

    const result = runScript("seal-state.js", [statePath(), "force bad state"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Refusing to seal invalid workflow state/);
    assert.match(result.stderr, /verified requires merged MR status/);
    assert.equal(loadState().harness.state_integrity, undefined);
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

  it("allows the matching test role into a dev task scope while testing", () => {
    const state = baseState();
    state.workspace_root = ".test-tmp";
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.scope.allowed_paths = ["frontend/**"];
    state.task_graph.tasks = [task];
    fs.mkdirSync(path.join(TMP, "project", "frontend"), { recursive: true });
    writeState(state);

    const target = path.join(TMP, "project", "frontend", "file.ts");
    const result = runScript("check-write-scope.js", [statePath(), target, "frontend_test"]);
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

  it("rejects test results from leases without exact test agent identity", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    state.task_graph.tasks = [task];
    state.agent_dispatch.leases = [{
      task_id: "FE-001",
      role: "frontend_test",
      agent_id: "ses_frontendtest",
      status: "leased",
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString()
    }];
    writeState(state);

    const result = runScript("record-test-results.js", [statePath(), "--task", "FE-001", "--status", "passed", "--role", "frontend_test", "--command", "npm test", "--output", "ok"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /missing valid frontend_test OpenCode lease/);
  });

  it("rejects manual MR check and merge evidence for dev tasks", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("record-test-results.js", [
      statePath(),
      "--task", "FE-001",
      "--status", "passed",
      "--role", "frontend_test",
      "--command", "npm test",
      "--output", "ok",
      "--merge-check-evidence", "checks passed",
      "--merged",
      "--merge-commit", "abc123"
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /dev-task MR check\/merge evidence must come from submit-task\.js/);
  });
});

describe("run-task-command.js", () => {
  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("records a bounded task command pass", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("run-task-command.js", [statePath(), "FE-001", "--role", "frontend_dev", "--label", "syntax check", "--timeout-ms", "2000", "--", process.execPath, "-e", "process.exit(0)"]);
    assert.equal(result.exitCode, 0);
    const run = loadState().task_graph.tasks[0].command_runs[0];
    assert.equal(run.status, "passed");
    assert.equal(run.label, "syntax check");
  });

  it("times out and records evidence instead of hanging", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "active";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("run-task-command.js", [statePath(), "FE-001", "--role", "frontend_dev", "--label", "stuck build", "--timeout-ms", "1000", "--", process.execPath, "-e", "setInterval(()=>{},1000)"]);
    assert.equal(result.exitCode, 124);
    assert.match(result.stderr, /timed out after 1000ms/);
    assert.equal(loadState().task_graph.tasks[0].command_runs[0].status, "timed_out");
  });
});

describe("submit-task.js", () => {
  before(() => {
    fs.mkdirSync(path.join(TMP, "test-output"), { recursive: true });
    fs.writeFileSync(path.join(TMP, "test-output", "test.log"), "ok\n");
  });

  after(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
  });

  it("refuses to submit before the separate test agent moves the task to testing", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "implemented";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    markLeaseCompleted(state, "FE-001", "frontend_dev");
    writeState(state);

    const result = runScript("submit-task.js", [statePath(), "FE-001", "--commit-msg", "feat: FE-001"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /runs only after frontend_test moves/);
  });

  it("requires recorded passed test evidence before git submission", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    task.test = { status: "not_run", commands: [], failures: [], evidence: [] };
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    markLeaseCompleted(state, "FE-001", "frontend_dev");
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("submit-task.js", [statePath(), "FE-001", "--commit-msg", "feat: FE-001"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /requires passed test evidence/);
  });

  it("accepts a completed exact dev lease after test sign-off", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    const task = devTask("FE-001", "frontend_dev", "frontend");
    task.status = "testing";
    state.task_graph.tasks = [task];
    addLease(state, "FE-001", "frontend_dev");
    markLeaseCompleted(state, "FE-001", "frontend_dev");
    addLease(state, "FE-001", "frontend_test");
    writeState(state);

    const result = runScript("submit-task.js", [
      statePath(),
      "FE-001",
      "--commit-msg", "feat: FE-001",
      "--repo-path", path.join(TMP, "not-a-repo")
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Not a git repository/);
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
    assert.equal(request.agent_name, "agent-spec-frontend-test");
    assert.match(request.prompt, /record-test-results/);
    assert.match(request.prompt, /record-pr-review/);
  });

  it("plans only one task even when frontend and backend are both runnable", () => {
    const state = baseState();
    state.current_state = "implementation_in_progress";
    state.task_graph.tasks = [
      devTask("FE-001", "frontend_dev", "frontend"),
      devTask("BE-001", "backend_dev", "backend")
    ];
    writeState(state);

    const result = runScript("plan-agent-dispatch.js", [statePath(), "--enable-auto"]);
    assert.equal(result.exitCode, 0);
    const planned = loadState().agent_dispatch.spawn_requests.filter((item) => item.status === "planned");
    assert.equal(planned.length, 1);
    assert.deepEqual(planned[0].task_ids, ["FE-001"]);
  });
});
