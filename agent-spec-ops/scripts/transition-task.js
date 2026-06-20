#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  states,
  transitions,
  taskStatuses,
  roleNames
} = require("./lib/state-machine");
const { execSync } = require("child_process");
const { appendEvent, appendTokenUsageRow } = require("./lib/memory-store");
const { checkContext } = require("./lib/context-check");
const { getLinearConfig } = require("./lib/linear-config");
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

if (nextStatus === "active") {
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
  const runDir = path.dirname(statePath);

  if (test.status !== "passed") {
    errors.push(`${taskId}: task.test.status must be "passed" before verified (record tests via scripts/record-test-results.js with --status passed)`);
  }
  if (!test.last_run_at) {
    errors.push(`${taskId}: task.test.last_run_at must be set before verified (tests must have been actually executed)`);
  }
  if (!test.commands || !test.commands.length) {
    errors.push(`${taskId}: task.test.commands must contain at least one test command before verified`);
  }
  if (test.failures && test.failures.length > 0) {
    errors.push(`${taskId}: task.test.failures must be empty before verified (${test.failures.length} failure(s) unresolved)`);
  }
  if (!test.output_file) {
    errors.push(`${taskId}: task.test.output_file must be set before verified (record tests via scripts/record-test-results.js with --output)`);
  } else {
    const outputPath = path.resolve(runDir, test.output_file);
    if (!fs.existsSync(outputPath)) {
      errors.push(`${taskId}: task.test.output_file "${test.output_file}" does not exist on disk. Agent may have set it manually without running tests.`);
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

  const isDevTask = ["frontend_dev", "backend_dev"].includes(task.role);
  if (isDevTask) {
    const git = task.git_flow || {};
    const policy = state.implementation && state.implementation.git_policy
      ? state.implementation.git_policy
      : {};

    if (!git.local_tests_passed || !git.test_evidence || !git.test_evidence.length) {
      errors.push(`${taskId}: git_flow.local_tests_passed with evidence required before verified`);
    }
    if (!git.pushed || !git.push_evidence || !git.push_evidence.length) {
      errors.push(`${taskId}: git_flow.pushed with evidence required before verified`);
    }
    if (!["created", "open", "merged"].includes(git.merge_request_status) || !git.merge_request_url) {
      errors.push(`${taskId}: git_flow must have merge_request (status: created|open|merged) with URL before verified`);
    }
    if (git.auto_merge) {
      if (!git.merge_checks_passed || !git.merge_check_evidence || !git.merge_check_evidence.length) {
        errors.push(`${taskId}: auto-merge requires merge_checks_passed with evidence before verified`);
      }
      if (!git.merged || git.merge_request_status !== "merged") {
        errors.push(`${taskId}: auto-merge requires merge completed before verified`);
      }
    }

    // Attempt remote git lifecycle enforcement if applicable
    const enforceScript = path.join(__dirname, "enforce-git-lifecycle.js");
    if (fs.existsSync(enforceScript) && !process.env.GIT_LIFECYCLE_SKIP) {
      const repoHint = policy.repo_path || "";
      const repoArg = repoHint ? ` --repo-path "${repoHint}"` : "";
      try {
        execSync(`node "${enforceScript}" "${statePath}" "${taskId}"${repoArg}`, {
          timeout: 10000,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"]
        });
        console.log(`  Git lifecycle enforcement: passed for ${taskId}`);
      } catch (err) {
        const output = err.stdout || "";
        const stderr = err.stderr || "";
        if (output.includes("not a git repository") || output.includes("skipping remote checks")) {
          console.log(`  Git lifecycle enforcement: skipped for ${taskId} (no git repo)`);
        } else {
          const details = output.includes("FAIL") ? output.split("\n").filter(l => l.includes("Failures")).join("; ") : stderr.trim();
          errors.push(`${taskId}: git lifecycle enforcement failed — ${details || "run scripts/enforce-git-lifecycle.js separately for details"}`);
        }
      }
    }
  }

  // === DOCKER COMPOSE INTEGRATION VERIFICATION ===
  if (errors.length === 0 && !process.env.SKIP_DOCKER_VERIFY) {
    const verifyScript = path.join(__dirname, "verify-integration.js");
    if (fs.existsSync(verifyScript)) {
      try {
        execSync(`node "${verifyScript}" "${statePath}"`, {
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

const now = new Date().toISOString();
task.status = nextStatus;
task.loop = task.loop || { status: "not_started", attempt: 0, max_attempts: 3, last_failure: "", history: [] };

if (nextStatus === "failed") {
  task.loop.status = "failed";
  task.loop.attempt = (task.loop.attempt || 0) + 1;
  task.loop.last_failure = note || "Unknown failure";
} else if (nextStatus === "verified") {
  task.loop.status = "completed";
  task.loop.attempt = (task.loop.attempt || 0) + 1;
} else if (nextStatus === "active") {
  task.loop.status = "in_progress";
  task.loop.attempt = (task.loop.attempt || 0) + 1;
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

state.delivery.updated_at = now;
state.log = state.log || [];
state.log.push({
  at: now,
  state: state.current_state,
  note: `Task ${taskId} transitioned: ${currentStatus} -> ${nextStatus}${note ? ` (${note})` : ""}`
});

fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

appendTokenUsageRow(statePath, {
  scope: "task",
  role: task.role,
  task_id: taskId,
  loop: task.loop ? task.loop.name || `${state.loops ? state.loops.length : 0}` : "",
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  total_cost_usd: 0,
  cost_basis: "unknown",
  notes: `Transition step: ${currentStatus} -> ${nextStatus}`
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
    } catch {}
  }, 100);
}

function laneStateForTask(task, allTasks) {
  const role = task.role;
  if (["frontend_dev", "frontend_test"].includes(role)) {
    const frontendTasks = allTasks.filter(
      (t) => ["frontend_dev", "frontend_test"].includes(t.role)
    );
    const allVerified = frontendTasks.every(
      (t) => t.status === "verified" || t.status === "not_applicable" || t.status === "waived"
    );
    if (task.status === "testing" || (task.status === "verified" && !allVerified)) {
      return "frontend_test";
    }
    if (task.status === "verified" && allVerified) {
      const backendTasks = allTasks.filter(
        (t) => ["backend_dev", "backend_test"].includes(t.role)
      );
      const allBackendVerified = backendTasks.length === 0 || backendTasks.every(
        (t) => t.status === "verified" || t.status === "not_applicable" || t.status === "waived"
      );
      if (allBackendVerified) {
        return "integration_verification";
      }
      return "frontend_verified";
    }
    if (task.status === "active" || task.status === "implemented") {
      return "frontend_dev";
    }
  }

  if (["backend_dev", "backend_test"].includes(role)) {
    const backendTasks = allTasks.filter(
      (t) => ["backend_dev", "backend_test"].includes(t.role)
    );
    const allVerified = backendTasks.every(
      (t) => t.status === "verified" || t.status === "not_applicable" || t.status === "waived"
    );
    if (task.status === "testing" || (task.status === "verified" && !allVerified)) {
      return "backend_test";
    }
    if (task.status === "verified" && allVerified) {
      const frontendTasks = allTasks.filter(
        (t) => ["frontend_dev", "frontend_test"].includes(t.role)
      );
      const allFrontendVerified = frontendTasks.length === 0 || frontendTasks.every(
        (t) => t.status === "verified" || t.status === "not_applicable" || t.status === "waived"
      );
      if (allFrontendVerified) {
        return "integration_verification";
      }
      return "backend_verified";
    }
    if (task.status === "active" || task.status === "implemented") {
      return "backend_dev";
    }
  }

  return "";
}
