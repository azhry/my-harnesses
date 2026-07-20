#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { expectedAgentName } = require("./lib/agent-identity");
const { loadWorkflowState, writeWorkflowState } = require("./lib/state-store");

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const enableAuto = args.includes("--enable-auto");
const taskArgIndex = args.indexOf("--task");
const requestedTaskId = taskArgIndex >= 0 ? String(args[taskArgIndex + 1] || "").trim() : "";

if (!file) {
  console.error("Usage: node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json [--enable-auto]");
  process.exit(1);
}

const statePath = path.resolve(file);
let state;
try {
  state = loadWorkflowState(statePath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const now = new Date().toISOString();
const tasks = state.task_graph.tasks || [];
const taskById = new Map(tasks.map((task) => [task.id, task]));

function taskDone(task) {
  return task && ["verified", "waived", "not_applicable"].includes(task.status);
}

function depsSatisfied(task) {
  return (task.depends_on || []).every((depId) => taskDone(taskById.get(depId)));
}

function activeLeaseTaskIds() {
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases)
    ? state.agent_dispatch.leases
    : [];
  return new Set(
    leases
      .filter((lease) => ["requested", "leased", "active"].includes(lease.status) && leaseIsCurrent(lease))
      .map((lease) => lease.task_id)
  );
}

function activeRoles() {
  const roles = new Set();
  for (const task of tasks) {
    if (task.status === "active") {
      roles.add(task.role);
    }
  }
  const leases = state.agent_dispatch && Array.isArray(state.agent_dispatch.leases)
    ? state.agent_dispatch.leases
    : [];
  for (const lease of leases) {
    if (["requested", "leased", "active"].includes(lease.status) && leaseIsCurrent(lease)) {
      roles.add(lease.role);
    }
  }
  return roles;
}

function scope(task) {
  return task.scope && Array.isArray(task.scope.allowed_paths)
    ? task.scope.allowed_paths.filter(Boolean)
    : [];
}

function overlaps(left, right) {
  for (const a of left) {
    for (const b of right) {
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        return true;
      }
      const aPrefix = staticPrefix(a);
      const bPrefix = staticPrefix(b);
      if (aPrefix && bPrefix && !aPrefix.startsWith(bPrefix) && !bPrefix.startsWith(aPrefix)) {
        continue;
      }
      if (a.includes("*") || b.includes("*")) {
        return true;
      }
    }
  }
  return false;
}

function staticPrefix(pattern) {
  const wildcard = String(pattern).search(/[*?]/);
  const prefix = wildcard === -1 ? String(pattern) : String(pattern).slice(0, wildcard);
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? prefix : prefix.slice(0, slash + 1);
}

function dispatchRoleFor(task) {
  if (task.status === "implemented" && task.role === "frontend_dev") return "frontend_test";
  if (task.status === "implemented" && task.role === "backend_dev") return "backend_test";
  if (["planned", "failed"].includes(task.status)) return task.role;
  return "";
}

function leaseIsCurrent(lease) {
  if (!lease || !lease.expires_at) return true;
  const expiresAt = Date.parse(lease.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function promptForTask(task, dispatchRole) {
  const gitFlow = task.git_flow || {};
  const gitPolicy = state.implementation && state.implementation.git_policy
    ? state.implementation.git_policy
    : { base_branch: "main", target_branch: "main" };
  const devGitInstructions = ["frontend_dev", "backend_dev"].includes(dispatchRole)
    ? [
      `Git lifecycle: create feature branch ${gitFlow.feature_branch || "(fill task git_flow.feature_branch)"} from ${gitPolicy.base_branch}.`,
      "Implement the assigned task and record changed files/evidence.",
      "Do not mark the task verified; the separate test agent owns test sign-off.",
      "Do not hand-write MR/check/merge evidence in workflow-state.json.",
      `After the separate test agent records passed tests, use submit-task.js for push, MR creation targeting ${gitPolicy.target_branch}, MR status comment, code-host check inspection, and merge.`,
      gitFlow.auto_merge === false
        ? `submit-task.js must respect auto_merge=false. Reason: ${gitFlow.auto_merge_disabled_reason || "(missing)"}`
        : "Do not run raw gh pr merge; submit-task.js owns merge after checks pass.",
      "If submit-task.js cannot complete, report its blocker instead of fabricating lifecycle evidence."
    ]
    : [];
  const testInstructions = ["frontend_test", "backend_test"].includes(dispatchRole)
    ? [
      "Test the assigned task only. Do not edit implementation files or claim dev ownership.",
      "Use transition-task.js to move the task to testing if needed.",
      "Run the verification commands from the task plan.",
      "Record passed/failed evidence with record-test-results.js using your test role.",
      "After submit-task.js creates the PR, inspect that exact PR and record passed/failed review evidence with record-pr-review.js for the submitted HEAD.",
      "A failed PR review returns the same task to dev; do not dispatch or start a different task.",
      "Do not pass --merged, --merge-commit, or --merge-check-evidence to record-test-results.js for dev tasks.",
      "Passed tests alone are not verified; submit-task.js creates the PR, independent review must pass, then submit-task.js may check and merge it.",
      "On failure, transition the task to failed so the dev agent loop resumes."
    ]
    : [];

  return [
    `Use the agent-spec-ops harness role ${dispatchRole} for task ${task.id}: ${task.title}.`,
    "You are not alone in the codebase; do not revert changes made by other agents, and keep edits inside your write scope.",
    `Delivery ID: ${state.delivery.id || "(unset)"}.`,
    `Lane: ${task.lane}.`,
    `Description: ${task.description}`,
    ...devGitInstructions,
    ...testInstructions,
    `Allowed write scope: ${scope(task).join(", ")}`,
    `Definition of done: ${(task.definition_of_done || []).join("; ")}`,
    `Verification: ${(task.verification || []).join("; ")}`,
    "Run build/test commands through run-task-command.js with a task label and a maximum 120000ms timeout. On timeout or failure, record evidence and hand the same task back; do not wait indefinitely or start another task.",
    "Update only your assigned task evidence/artifacts. The orchestrator owns top-level workflow transitions."
  ].join("\n");
}

function runnableTasks() {
  const lifecycleTask = tasks.find((task) =>
    task.lifecycle_enforced === true && ["active", "implemented", "testing", "failed", "blocked"].includes(task.status)
  );
  const activeLeases = activeLeaseTaskIds();
  const blockedRoles = activeRoles();
  return tasks.filter((task) => {
    if (requestedTaskId && task.id !== requestedTaskId) return false;
    const dispatchRole = dispatchRoleFor(task);
    if (!["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(dispatchRole)) {
      return false;
    }
    if (!["planned", "failed", "implemented"].includes(task.status)) {
      return false;
    }
    if (lifecycleTask && lifecycleTask.id !== task.id) {
      return false;
    }
    if (!depsSatisfied(task)) {
      return false;
    }
    if (activeLeases.has(task.id)) {
      return false;
    }
    if (blockedRoles.has(dispatchRole)) {
      return false;
    }
    return true;
  });
}

function chooseParallelTasks(candidates, maxParallel) {
  const chosen = [];
  const blockers = [];

  for (const task of candidates) {
    const writeScope = scope(task);
    if (!writeScope.length) {
      blockers.push(`Task ${task.id} has no scope.allowed_paths; refusing automatic parallel dispatch.`);
      continue;
    }
    if (chosen.some((existing) => overlaps(scope(existing), writeScope))) {
      blockers.push(`Task ${task.id} write scope overlaps another selected task; keep it serialized.`);
      continue;
    }
    chosen.push(task);
    if (chosen.length >= Math.min(maxParallel, 1)) {
      break;
    }
  }

  return { chosen, blockers };
}

state.agent_dispatch = state.agent_dispatch || {
  mode: "single_agent",
  auto_spawn: false,
  parallel_allowed: true,
  max_parallel_agents: 2,
  status: "not_started",
  planned_at: "",
  spawn_requests: [],
  leases: [],
  history: []
};

if (enableAuto) {
  state.agent_dispatch.mode = "multi_agent";
  state.agent_dispatch.auto_spawn = true;
}

// Delivery execution is deliberately serialized. Dev and test agents hand the
// same task to each other, but a second task cannot start until the first one is
// verified (including PR review/merge and Linear synchronization).
state.agent_dispatch.parallel_allowed = false;
state.agent_dispatch.max_parallel_agents = 1;

const eligibleState = state.current_state === "implementation_in_progress";
const candidates = eligibleState ? runnableTasks() : [];
const { chosen, blockers } = chooseParallelTasks(candidates, state.agent_dispatch.max_parallel_agents || 2);
const shouldPlan = state.agent_dispatch.mode === "multi_agent" && state.agent_dispatch.auto_spawn;

if (!shouldPlan) {
  state.agent_dispatch.status = "blocked";
  state.agent_dispatch.history.push({
    at: now,
    state: state.current_state,
    note: "Automatic dispatch not enabled; set mode=multi_agent and auto_spawn=true or run with --enable-auto."
  });
} else if (!eligibleState) {
  state.agent_dispatch.status = "blocked";
  state.agent_dispatch.history.push({
    at: now,
    state: state.current_state,
    note: `Current state ${state.current_state} is not eligible for implementation agent dispatch.`
  });
} else if (!chosen.length) {
  state.agent_dispatch.status = blockers.length ? "blocked" : "planned";
  state.agent_dispatch.history.push({
    at: now,
    state: state.current_state,
    note: blockers.length ? blockers.join(" ") : "No runnable tasks found for automatic dispatch."
  });
} else {
  const existingOpenRequestTaskIds = new Set(
    (state.agent_dispatch.spawn_requests || [])
      .filter((request) => ["planned", "spawned", "active"].includes(request.status))
      .flatMap((request) => request.task_ids)
  );
  const newRequests = chosen
    .filter((task) => !existingOpenRequestTaskIds.has(task.id))
    .map((task) => {
      const dispatchRole = dispatchRoleFor(task);
      return {
        id: `spawn-${dispatchRole}-${task.id}-${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
        role: dispatchRole,
        agent_name: expectedAgentName(dispatchRole),
        lane: task.lane,
        task_ids: [task.id],
        status: "planned",
        agent_id: "",
        prompt: promptForTask(task, dispatchRole),
        write_scope: scope(task),
        created_at: now,
        updated_at: now,
        blockers: []
      };
    });

  state.agent_dispatch.spawn_requests = [
    ...(state.agent_dispatch.spawn_requests || []),
    ...newRequests
  ];
  state.agent_dispatch.status = newRequests.length ? "planned" : "active";
  state.agent_dispatch.planned_at = now;
  state.agent_dispatch.history.push({
    at: now,
    state: state.current_state,
    note: `Planned ${newRequests.length} spawn request(s). ${blockers.join(" ")}`
  });
}

state.delivery.updated_at = now;
state.log.push({
  at: now,
  state: state.current_state,
  note: `Agent dispatch planning completed: ${state.agent_dispatch.status}`
});

writeWorkflowState(statePath, state, { writer: "plan-agent-dispatch.js" });

const planned = (state.agent_dispatch.spawn_requests || []).filter((request) => request.status === "planned");
console.log(`Agent dispatch status: ${state.agent_dispatch.status}`);
if (requestedTaskId) console.log(`Requested task: ${requestedTaskId}`);
console.log(`Planned spawn requests: ${planned.length}`);
for (const request of planned) {
  console.log(`- ${request.id}: ${request.agent_name || expectedAgentName(request.role)} ${request.task_ids.join(", ")} scope=${request.write_scope.join(", ")}`);
}
if (state.agent_dispatch.status === "blocked") {
  process.exit(2);
}
