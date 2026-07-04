#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  taskStatuses
} = require("./lib/state-machine");
const { execSync } = require("child_process");
const { appendEvent } = require("./lib/memory-store");
const { checkContext, updateSessionMarker } = require("./lib/context-check");
const { getLinearConfig } = require("./lib/linear-config");
const { enforcePolicy } = require("./lib/policy");
const { loadSecretEnv } = require("./lib/env-loader");
const harnessRoot = path.resolve(__dirname, "..");

const ALLOWED_TRANSITIONS = {
  planned: ["active", "blocked", "waived", "not_applicable"],
  active: ["implemented", "failed", "blocked", "waived", "not_applicable"],
  implemented: ["testing", "failed", "blocked", "waived", "not_applicable"],
  testing: ["verified", "implemented", "failed", "blocked", "waived", "not_applicable"],
  verified: ["failed", "blocked"],
  failed: ["active", "implemented", "testing", "blocked", "waived", "not_applicable"],
  blocked: ["planned", "active", "waived", "not_applicable"],
  waived: [],
  not_applicable: []
};

const LANE_ROLE_MAP = {
  frontend_dev: "frontend",
  frontend_test: "frontend",
  backend_dev: "backend",
  backend_test: "backend",
  orchestrator: "integration",
  product_manager: "product",
  project_manager: "planning"
};

const [file, taskId, nextStatus, ...noteParts] = process.argv.slice(2);
const note = noteParts.join(" ").trim();

checkContext("transition-task.js");

if (!file || !taskId || !nextStatus) {
  console.error("Usage: node scripts/transition-task.js path/to/workflow-state.json TASK_ID STATUS [NOTE]");
  console.error("");
  console.error("Task statuses: " + taskStatuses.join(", "));
  console.error("");
  console.error("Per-task transitions:");
  console.error("  planned  -> active, blocked, waived, not_applicable");
  console.error("  active   -> implemented, failed, blocked, waived, not_applicable");
  console.error("  implemented -> testing, failed, blocked, waived, not_applicable");
  console.error("  testing  -> verified, implemented, failed, blocked, waived, not_applicable");
  console.error("  verified -> failed, blocked");
  console.error("  failed   -> active, implemented, testing, blocked, waived, not_applicable");
  console.error("  blocked  -> planned, active, waived, not_applicable");
  process.exit(1);
}

if (!taskStatuses.includes(nextStatus)) {
  console.error(`Invalid task status: ${nextStatus}`);
  console.error(`Allowed: ${taskStatuses.join(", ")}`);
  process.exit(1);
}

const statePath = path.resolve(file);
loadSecretEnv(statePath);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const tasks = state.task_graph && Array.isArray(state.task_graph.tasks)
  ? state.task_graph.tasks
  : [];
const taskIndex = tasks.findIndex((t) => t.id === taskId);

if (taskIndex === -1) {
  console.error(`Task not found: ${taskId}`);
  process.exit(1);
}

const task = tasks[taskIndex];
const currentStatus = task.status;
const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];

if (!allowed.includes(nextStatus)) {
  console.error(`Illegal task transition: ${taskId} ${currentStatus} -> ${nextStatus}`);
  console.error(`Allowed from ${currentStatus}: ${allowed.join(", ") || "(none)"}`);
  process.exit(1);
}

const errors = [];
const leaseRole = requiredLeaseRoleForTransition(task, nextStatus, currentStatus);

if (leaseRole && !hasActiveLease(state, taskId, leaseRole)) {
  errors.push(`${taskId}: ${nextStatus} requires a recorded ${leaseRole} subagent lease. Run plan-agent-dispatch.js, spawn the requested agent, then record it with record-agent-spawn.js.`);
}

if (nextStatus === "active") {
  const loop = task.loop || {};
  if (currentStatus === "failed" && Number(loop.attempt || 0) >= Number(loop.max_attempts || 3)) {
    errors.push(`${taskId}: dev/test loop reached ${loop.attempt}/${loop.max_attempts || 3}. Stop and ask the user to intervene before retrying.`);
  }
  if (Array.isArray(task.depends_on) && task.depends_on.length > 0) {
    const depTaskIds = new Set(task.depends_on);
    for (const t of tasks) {
      if (depTaskIds.has(t.id) && t.status !== "verified" && t.status !== "not_applicable" && t.status !== "waived") {
        errors.push(`${taskId} depends on ${t.id} which is not verified (status: ${t.status})`);
      }
    }
  }
  const lane = LANE_ROLE_MAP[task.role] || "unknown";
  const activeInLane = tasks.filter(
    (t) => (LANE_ROLE_MAP[t.role] || "unknown") === lane && t.status === "active" && t.id !== taskId
  );
  if (activeInLane.length > 0) {
    errors.push(`WIP=1 violation: ${task.role} lane already has active task: ${activeInLane[0].id}`);
  }
}

if (nextStatus === "verified") {
  // === UNIFIED TEST EXECUTION ENFORCEMENT (all roles) ===
  const test = task.test || {};
  const implementation = task.implementation || {};
  const runDir = path.dirname(statePath);

  if (isDevTask(task)) {
    if (!Array.isArray(implementation.changed_files) || implementation.changed_files.length === 0) {
      errors.push(`${taskId}: Cannot transition to verified. implementation.changed_files is empty.`);
    }
    if (!Array.isArray(implementation.evidence) || implementation.evidence.length === 0) {
      errors.push(`${taskId}: Cannot transition to verified. implementation.evidence is empty.`);
    }
  }
  if (test.status !== "passed") {
    errors.push(`${taskId}: Cannot transition to verified. You forgot to run tests. Run 'node scripts/submit-task.js' to automate this, or manually run 'scripts/record-test-results.js'.`);
  }
  if (!test.last_run_at) {
    errors.push(`${taskId}: Cannot transition to verified. You forgot to execute tests. Run 'node scripts/submit-task.js' first.`);
  }
  if (!test.commands || !test.commands.length) {
    errors.push(`${taskId}: Cannot transition to verified. No test commands recorded. Run 'node scripts/submit-task.js' first.`);
  }
  if (test.failures && test.failures.length > 0) {
    errors.push(`${taskId}: Cannot transition to verified. Tests are failing. Fix tests and run 'node scripts/submit-task.js' again.`);
  }
  if (!test.output_file) {
    errors.push(`${taskId}: Cannot transition to verified. You forgot to record test output. Run 'node scripts/submit-task.js' first.`);
  } else {
    const outputPath = resolveRunPath(runDir, test.output_file);
    if (!fs.existsSync(outputPath)) {
      errors.push(`${taskId}: Cannot transition to verified. Test output file "${test.output_file}" is missing. Run 'node scripts/submit-task.js' again.`);
    }
  }

  // === SCOPE ENFORCEMENT: changed_files must match approved repos ===
  const approvedRepos = new Set();
  const allTasks = state.task_graph && Array.isArray(state.task_graph.tasks) ? state.task_graph.tasks : [];
  for (const t of allTasks) {
    if (t.scope && Array.isArray(t.scope.allowed_repos)) {
      for (const r of t.scope.allowed_repos) approvedRepos.add(r);
    }
  }
  if (approvedRepos.size > 0 && Array.isArray(task.implementation && task.implementation.changed_files)) {
    for (const cf of task.implementation.changed_files) {
      const cfRepo = cf.split(/[/\\]/)[0];
      if (cfRepo && !approvedRepos.has(cfRepo) && !cf.startsWith("runs/")) {
        errors.push(`${taskId}: changed_file "${cf}" references repo "${cfRepo}" not in approved repos: ${[...approvedRepos].join(", ")}`);
      }
    }
  }

  if (isDevTask(task)) {
    const git = task.git_flow || {};

    if (!git.branch_created || !git.feature_branch) {
      errors.push(`${taskId}: Cannot transition to verified. Git flow branch evidence is missing. Run 'node scripts/submit-task.js'.`);
    }
    if (!git.local_tests_passed || !git.test_evidence || !git.test_evidence.length) {
      errors.push(`${taskId}: Cannot transition to verified. Git flow 'local_tests_passed' is missing. Run 'node scripts/submit-task.js' to fix this automatically.`);
    }
    if (!git.pushed || !git.push_evidence || !git.push_evidence.length) {
      errors.push(`${taskId}: Cannot transition to verified. Git flow 'pushed' is missing. Run 'node scripts/submit-task.js' to fix this automatically.`);
    }
    if (git.merge_request_status !== "merged" || !git.merge_request_url) {
      errors.push(`${taskId}: Cannot transition to verified. The merge request must be merged before verification. Run 'node scripts/submit-task.js' or record merged MR evidence.`);
    }
    if (git.merge_request_comment_status !== "passed" || !git.merge_request_comment_url || !(git.merge_request_comment_evidence || []).length) {
      errors.push(`${taskId}: Cannot transition to verified. MR status comment URL/evidence with status 'passed' is missing. Run 'node scripts/submit-task.js' after tests.`);
    }
    if (git.merged !== true || !git.merge_commit || !(git.merge_evidence || []).length) {
      errors.push(`${taskId}: Cannot transition to verified. Merged MR evidence is missing. Required: git_flow.merged=true, merge_commit, and merge_evidence.`);
    }
  }

  // === DOCKER COMPOSE INTEGRATION VERIFICATION ===
  if (errors.length === 0) {
    const verifyScript = path.join(__dirname, "verify-integration.js");
    if (fs.existsSync(verifyScript)) {
      try {
        execSync(`"${process.execPath}" "${verifyScript}" "${statePath}"`, {
          cwd: harnessRoot, encoding: "utf8", stdio: "pipe", timeout: 120000
        });
        console.log(`  Integration verification (docker compose): passed for ${taskId}`);
      } catch (e) {
        const output = (e.stdout || e.stderr || e.message || "").trim();
        if (output.includes("No docker-compose file found") || output.includes("No repos defined")) {
          console.log(`  Integration verification: skipped (no docker compose)`);
        } else {
          errors.push(`${taskId}: Integration (docker compose) verification failed. The change may break the running system:\n${output}`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error("Task transition rejected:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

try {
  enforcePolicy(statePath, { phase: "task_transition", taskId, nextStatus });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const now = new Date().toISOString();
task.status = nextStatus;
task.loop = task.loop || { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] };

if (nextStatus === "failed") {
  task.loop.status = "failed";
  task.loop.attempt = (task.loop.attempt || 0) + 1;
  task.loop.last_failure = note || "Unknown failure";
  if (task.loop.attempt >= (task.loop.max_attempts || 3)) {
    console.warn(`Loop cap reached for ${taskId}: ${task.loop.attempt}/${task.loop.max_attempts || 3}. User intervention required before retry.`);
  }
} else if (nextStatus === "verified") {
  task.loop.status = "completed";
  task.loop.attempt = 0;
  task.loop.last_failure = "";
} else if (nextStatus === "active") {
  task.loop.status = "in_progress";
} else if (nextStatus === "blocked") {
  task.loop.status = "blocked";
} else if (nextStatus === "implemented") {
  task.loop.status = task.loop.status === "failed" ? "failed" : "in_progress";
} else if (nextStatus === "testing") {
  task.loop.status = "in_progress";
}
task.loop.history = task.loop.history || [];
task.loop.history.push(`${now}: ${currentStatus} -> ${nextStatus}${note ? ` — ${note}` : ""}`);

const role = state.roles[task.role];
if (role) {
  if (nextStatus === "active" || nextStatus === "implemented") {
    role.status = "in_progress";
  } else if (nextStatus === "testing") {
    role.status = "in_progress";
  } else if (nextStatus === "verified") {
    role.status = "complete";
  } else if (nextStatus === "failed" || nextStatus === "blocked") {
    role.status = nextStatus;
  }
  role.current_task_id = taskId;
}

const laneStateKey = laneStateForTask(task, tasks);
if (laneStateKey) {
  state.current_state = laneStateKey;
}
updateLeasesForTransition(state, taskId, leaseRole, nextStatus);
updateSpawnRequestsForTransition(state, taskId, leaseRole, nextStatus);

state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: state.current_state,
  note: `Task ${taskId} transitioned: ${currentStatus} -> ${nextStatus}${note ? ` (${note})` : ""}`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
updateSessionMarker(statePath, {
  state: state.current_state,
  state_updated_at: state.delivery.updated_at,
  tasks_verified: tasks.filter((t) => t.status === "verified").length
});

console.log(`OK: ${taskId} ${currentStatus} -> ${nextStatus}`);

const eventType = {
  active: "task_started",
  implemented: "task_implemented",
  testing: "task_testing",
  verified: "task_complete",
  failed: "task_failed",
  blocked: "task_blocked"
}[nextStatus] || "task_transition";

appendEvent(statePath, {
  type: eventType,
  role_context: task.role,
  task_id: taskId,
  target: nextStatus,
  summary: `${taskId} ${currentStatus} -> ${nextStatus}`,
  details: note || `${task.title || taskId} moved to ${nextStatus}`,
  severity: nextStatus === "failed" || nextStatus === "blocked" ? "warning" : "info",
  tags: ["task_transition", taskId, nextStatus]
});

const linearCfg = getLinearConfig(state);
if (task.linear_id && linearCfg.api_key) {
  setTimeout(() => {
    try {
      const syncScript = path.join(__dirname, "sync-linear-task.js");
      execSync(`node "${syncScript}" "${statePath}" --task ${taskId}`, {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        stdio: "ignore",
        timeout: 10000
      });
    } catch { }
  }, 100);
}

function laneStateForTask(task, allTasks) {
  return "";
}

function isDevTask(task) {
  return task.role === "frontend_dev" || task.role === "backend_dev";
}

function testRoleForDevRole(role) {
  if (role === "frontend_dev") return "frontend_test";
  if (role === "backend_dev") return "backend_test";
  return "";
}

function requiredLeaseRoleForTransition(task, nextStatus, currentStatus) {
  if (!["active", "implemented", "testing", "verified", "failed"].includes(nextStatus)) {
    return "";
  }
  if (isDevTask(task) && nextStatus === "failed" && currentStatus === "testing") {
    return testRoleForDevRole(task.role);
  }
  if (isDevTask(task) && (nextStatus === "testing" || nextStatus === "verified")) {
    return testRoleForDevRole(task.role);
  }
  return task.role || "";
}

function hasActiveLease(state, taskId, role) {
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases)
    ? state.agent_dispatch.leases
    : [];
  return leases.some((lease) =>
    lease &&
    lease.task_id === taskId &&
    lease.role === role &&
    lease.agent_id &&
    ["leased", "active"].includes(lease.status || "leased")
  );
}

function updateLeasesForTransition(state, taskId, role, nextStatus) {
  if (!role || !state.agent_dispatch || !Array.isArray(state.agent_dispatch.leases)) {
    return;
  }
  const lease = state.agent_dispatch.leases.find((item) =>
    item &&
    item.task_id === taskId &&
    item.role === role &&
    ["leased", "active"].includes(item.status || "leased")
  );
  if (!lease) return;
  if (nextStatus === "active" || nextStatus === "testing") {
    lease.status = "active";
  }
  if (nextStatus === "implemented" || nextStatus === "verified" || nextStatus === "failed") {
    lease.status = "completed";
    lease.completed_at = new Date().toISOString();
  }
}

function updateSpawnRequestsForTransition(state, taskId, role, nextStatus) {
  if (!role || !state.agent_dispatch || !Array.isArray(state.agent_dispatch.spawn_requests)) {
    return;
  }
  const shouldComplete = nextStatus === "implemented" || nextStatus === "verified" || nextStatus === "failed";
  const shouldActivate = nextStatus === "active" || nextStatus === "testing";
  for (const request of state.agent_dispatch.spawn_requests) {
    if (!request || request.role !== role || !(request.task_ids || []).includes(taskId)) {
      continue;
    }
    if (shouldActivate && ["planned", "spawned"].includes(request.status)) {
      request.status = "active";
      request.updated_at = new Date().toISOString();
    }
    if (shouldComplete && ["planned", "spawned", "active"].includes(request.status)) {
      request.status = "completed";
      request.updated_at = new Date().toISOString();
    }
  }
}

function resolveRunPath(runDir, value) {
  if (path.isAbsolute(value)) return value;
  const normalized = String(value).replace(/\\/g, "/");
  if (normalized.startsWith("runs/")) {
    return path.resolve(harnessRoot, normalized);
  }
  return path.resolve(runDir, value);
}
