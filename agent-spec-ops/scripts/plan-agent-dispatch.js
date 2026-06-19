#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const enableAuto = args.includes("--enable-auto");

if (!file) {
  console.error("Usage: node scripts/plan-agent-dispatch.js runs/<DELIVERY_ID>/workflow-state.json [--enable-auto]");
  process.exit(1);
}

const statePath = path.resolve(file);
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const now = new Date().toISOString();
const tasks = state.task_graph.tasks || [];
const taskById = new Map(tasks.map((task) => [task.id, task]));

function taskDone(task) {
  return task && ["implemented", "verified", "waived", "not_applicable"].includes(task.status);
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
      .filter((lease) => ["requested", "leased"].includes(lease.status))
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
    if (["requested", "leased"].includes(lease.status)) {
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

function promptForTask(task) {
  const gitFlow = task.git_flow || {};
  const gitPolicy = state.implementation && state.implementation.git_policy
    ? state.implementation.git_policy
    : { base_branch: "main", target_branch: "main" };
  const devGitInstructions = ["frontend_dev", "backend_dev"].includes(task.role)
    ? [
      `Git lifecycle: create feature branch ${gitFlow.feature_branch || "(fill task git_flow.feature_branch)"} from ${gitPolicy.base_branch}.`,
      "Implement the task on that feature branch.",
      "After matching tests pass, push the feature branch.",
      `Create a merge request/pull request targeting ${gitPolicy.target_branch}.`,
      gitFlow.auto_merge === false
        ? `Do not merge automatically because auto_merge=false. Reason: ${gitFlow.auto_merge_disabled_reason || "(missing)"}`
        : "After merge checks pass, merge the merge request/pull request by default.",
      "Record branch, test, push, MR, merge-check, and merge evidence in task.git_flow."
    ]
    : [];

  return [
    `Use the agent-spec-ops harness role ${task.role} for task ${task.id}: ${task.title}.`,
    "You are not alone in the codebase; do not revert changes made by other agents, and keep edits inside your write scope.",
    `Delivery ID: ${state.delivery.id || "(unset)"}.`,
    `Lane: ${task.lane}.`,
    `Description: ${task.description}`,
    ...devGitInstructions,
    `Allowed write scope: ${scope(task).join(", ")}`,
    `Definition of done: ${(task.definition_of_done || []).join("; ")}`,
    `Verification: ${(task.verification || []).join("; ")}`,
    "Update only your assigned task evidence/artifacts. The orchestrator owns top-level workflow transitions."
  ].join("\n");
}

function runnableTasks() {
  const activeLeases = activeLeaseTaskIds();
  const blockedRoles = activeRoles();
  const runnableStatuses = ["planned", "failed"];
  return tasks.filter((task) => {
    if (!["frontend_dev", "frontend_test", "backend_dev", "backend_test"].includes(task.role)) {
      return false;
    }
    if (!runnableStatuses.includes(task.status)) {
      return false;
    }
    if (!depsSatisfied(task)) {
      return false;
    }
    if (activeLeases.has(task.id)) {
      return false;
    }
    if (blockedRoles.has(task.role)) {
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
    if (chosen.length >= maxParallel) {
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

const eligibleState = ["delivery_plan_approved", "implementation_in_progress", "frontend_dev", "backend_dev", "frontend_test", "backend_test"].includes(state.current_state);
const candidates = eligibleState ? runnableTasks() : [];
const { chosen, blockers } = chooseParallelTasks(candidates, state.agent_dispatch.max_parallel_agents || 2);
const shouldPlan = state.agent_dispatch.mode === "multi_agent" && state.agent_dispatch.auto_spawn && state.agent_dispatch.parallel_allowed;

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
    .map((task) => ({
      id: `spawn-${task.id}-${now.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
      role: task.role,
      lane: task.lane,
      task_ids: [task.id],
      status: "planned",
      agent_id: "",
      prompt: promptForTask(task),
      write_scope: scope(task),
      created_at: now,
      updated_at: now,
      blockers: []
    }));

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

fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const planned = (state.agent_dispatch.spawn_requests || []).filter((request) => request.status === "planned");
console.log(`Agent dispatch status: ${state.agent_dispatch.status}`);
console.log(`Planned spawn requests: ${planned.length}`);
for (const request of planned) {
  console.log(`- ${request.id}: ${request.role} ${request.task_ids.join(", ")} scope=${request.write_scope.join(", ")}`);
}
if (state.agent_dispatch.status === "blocked") {
  process.exit(2);
}
